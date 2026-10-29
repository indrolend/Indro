import test from 'node:test';
import assert from 'node:assert/strict';
import { runFlCli } from './cli.mjs';

const session = { schema: 'indro.fl.bridge.v1', session_id: 'live-session', process_id: 42 };

function fixture({ plugin = 'Fruity Granulizer', initial = 0.5, ignoreWrite = false, timeout = false } = {}) {
  let value = initial;
  const calls = [];
  const transport = {
    name: 'fixture-transport',
    async request(operation, request = {}) {
      calls.push({ operation, request });
      if (timeout && operation === 'plugin.set') {
        const error = new Error('FL_RESPONSE_TIMEOUT_OUTCOME_UNKNOWN'); error.transactionId = request.transactionId; throw error;
      }
      const identity = { channel: 0, channel_name: 'Granulizer', plugin_valid: true, plugin_name: plugin };
      let result;
      if (operation === 'ping' || operation === 'status') result = { selected: identity, channel_count: 1, playing: false };
      else if (operation === 'plugin.inspect') result = { ...identity, parameter_count: 103 };
      else if (operation === 'plugin.params') result = { ...identity, parameter_count: 1, parameters: [{ index: 2, name: 'Grain spacing', value }] };
      else if (operation === 'plugin.get') result = { ...identity, parameter: 2, parameter_name: 'Grain spacing', value };
      else if (operation === 'plugin.set') {
        const before = value; if (!ignoreWrite) value = request.arguments.value;
        result = { before: { ...identity, parameter: 2, value: before }, requested: request.arguments.value,
          readback: { ...identity, parameter: 2, value } };
      } else result = {};
      return { response: { schema: 'indro.fl.bridge.v1', transaction_id: request.transactionId ?? 'read',
        session_id: 'live-session', received_unix_ms: Date.now(), accepted: true, executed: true, result } };
    }
  };
  return { transport, calls, value: () => value };
}

async function run(args, dependencies) {
  const output = []; const errors = [];
  const code = await runFlCli(args, line => output.push(line), line => errors.push(line), {
    discoverSession: () => session, persistReceipt: () => ({ path: 'receipt.json', sha256: 'a'.repeat(64) }), ...dependencies
  });
  return { code, value: output.length ? JSON.parse(output.at(-1)) : null, errors };
}

test('doctor reports live bridge facts and never fabricates disconnected state', async () => {
  const connected = await run(['doctor', '--json'], fixture());
  assert.equal(connected.code, 0); assert.equal(connected.value.connected, true);
  const disconnected = await runFlCli(['doctor', '--json'], () => {}, () => {}, { discoverSession: () => { throw Error('FL_BRIDGE_DISCONNECTED'); } });
  assert.equal(disconnected, 1);
});

test('parameter discovery and read return host values', async () => {
  const f = fixture();
  assert.equal((await run(['plugin', 'params', '--channel', '0', '--json'], f)).value.parameter_count, 1);
  assert.equal((await run(['plugin', 'get', '--channel', '0', '--param', '2', '--json'], f)).value.value, 0.5);
});

test('verified write observes transition and already-satisfied state separately', async () => {
  const changed = await run(['plugin', 'set', '--channel', '0', '--param', '2', '--value', '0.25', '--verify', '--json'], fixture());
  assert.equal(changed.code, 0); assert.equal(changed.value.claims.state_transition_observed, true);
  const same = await run(['plugin', 'set', '--channel', '0', '--param', '2', '--value', '0.5', '--verify', '--json'], fixture());
  assert.equal(same.code, 0); assert.equal(same.value.claims.state_transition_observed, false);
});

test('unchanged readback and timeout after possible mutation cannot become success', async () => {
  const unchanged = await run(['plugin', 'set', '--channel', '0', '--param', '2', '--value', '0.25', '--verify', '--json'], fixture({ ignoreWrite: true }));
  assert.equal(unchanged.code, 1); assert.equal(unchanged.value.transaction.verdict, 'READBACK_MISMATCH');
  const timed = await run(['plugin', 'set', '--channel', '0', '--param', '2', '--value', '0.25', '--verify', '--json'], fixture({ timeout: true }));
  assert.equal(timed.code, 1); assert.equal(timed.value.transaction.verdict, 'TRANSPORT_UNKNOWN');
});

test('writes require verify, valid range, parameter, and exact plugin identity', async () => {
  for (const args of [
    ['plugin', 'set', '--channel', '0', '--param', '2', '--value', '0.2', '--json'],
    ['plugin', 'set', '--channel', '0', '--param', '2', '--value', '2', '--verify', '--json'],
    ['plugin', 'get', '--channel', '0', '--param', '-1', '--json'],
  ]) assert.equal((await run(args, fixture())).code, 1);
  const wrong = fixture({ plugin: 'Sytrus' });
  const result = await run(['plugin', 'set', '--channel', '0', '--param', '2', '--value', '0.2', '--verify', '--json'], wrong);
  assert.equal(result.value.transaction.target.plugin_name, 'Sytrus');
});

test('operation-scoped validation snapshot avoids duplicate inspect and rejects stale scope', async () => {
  const f = fixture();
  const snapshot = { app_id: 'fl-studio', session_id: 'live-session', process_id: 42,
    channel: 0, channel_name: 'Granulizer', plugin_name: 'Fruity Granulizer', parameter: 2 };
  const changed = await run(['plugin', 'set', '--channel', '0', '--param', '2', '--value', '0.25', '--verify', '--json'], { ...f, validationSnapshot: snapshot });
  assert.equal(changed.code, 0);
  assert.equal(f.calls.some(call => call.operation === 'plugin.inspect'), false);
  const stale = await run(['plugin', 'set', '--channel', '0', '--param', '2', '--value', '0.25', '--verify', '--json'], { ...fixture(), validationSnapshot: { ...snapshot, session_id: 'old-session' } });
  assert.equal(stale.code, 1); assert.equal(stale.value.error, 'VALIDATION_SNAPSHOT_STALE');
  const wrong = await run(['plugin', 'set', '--channel', '0', '--param', '2', '--value', '0.25', '--verify', '--json'], { ...fixture(), validationSnapshot: { ...snapshot, channel: 1 } });
  assert.equal(wrong.code, 1); assert.equal(wrong.value.error, 'VALIDATION_SNAPSHOT_SCOPE_MISMATCH');
});

test('retained parameter name reaches each host observation and write; generic index CLI stays compatible', async () => {
  const f = fixture();
  const args = ['plugin', 'set', '--channel', '0', '--param', '2', '--value', '0.25', '--verify', '--json'];
  const result = await run(args, { ...f, expectedParameterName: 'Grain spacing' });
  assert.equal(result.code, 0);
  const calls = f.calls.filter(x => ['plugin.get', 'plugin.set'].includes(x.operation));
  assert.ok(calls.length >= 3);
  assert.ok(calls.every(x => x.request.target.parameter_name === 'Grain spacing'));
  const generic = fixture();
  assert.equal((await run(args, generic)).code, 0);
  assert.equal(generic.calls.find(x => x.operation === 'plugin.set').request.target.parameter_name, undefined);
});

test('host parameter-identity rejection prevents a stale-mapping write', async () => {
  const f = fixture();
  const original = f.transport.request.bind(f.transport);
  let rejected = 0;
  let writes = 0;
  f.transport.request = async (operation, request = {}) => {
    if (operation === 'plugin.set') {
      if (request.target.parameter_name !== 'Attack') {
        rejected++;
        return { response: { schema: 'indro.fl.bridge.v1', transaction_id: request.transactionId,
          session_id: 'live-session', accepted: false, executed: false, error: 'WRONG_PARAMETER_IDENTITY' } };
      }
      writes++;
    }
    return original(operation, request);
  };
  const result = await run(['plugin', 'set', '--channel', '0', '--param', '2', '--value', '0.25', '--verify', '--json'],
    { ...f, expectedParameterName: 'Grain spacing' });
  assert.equal(result.code, 1);
  assert.equal(rejected, 1);
  assert.equal(writes, 0);
});

test('retained plugin identity rejects replacement after discovery before any write', async () => {
  const f = fixture({ plugin: 'Sytrus' });
  const result = await run(['plugin', 'set', '--channel', '0', '--param', '2', '--value', '0.25', '--verify', '--json'],
    { ...f, expectedPluginName: 'Fruity Granulizer', expectedParameterName: 'Grain spacing' });
  assert.equal(result.code, 1);
  assert.equal(result.value.error, 'WRONG_PLUGIN_IDENTITY');
  assert.equal(f.calls.some(x => x.operation === 'plugin.set'), false);
});
