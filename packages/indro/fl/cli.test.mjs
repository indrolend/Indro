import test from 'node:test';
import assert from 'node:assert/strict';
import { runFlCli } from './cli.mjs';

const session = { schema: 'indro.fl.bridge.v1', session_id: 'live-session', process_id: 42 };

function fixture({ plugin = 'Fruity Granulizer', initial = 0.5, ignoreWrite = false, timeout = false, playing = false } = {}) {
  let value = initial;
  const calls = [];
  const transport = {
    name: 'fixture-transport',
    async request(operation, request = {}) {
      calls.push({ operation, request });
      if (timeout && ['plugin.set', 'transport.play', 'transport.stop'].includes(operation)) {
        const error = new Error('FL_RESPONSE_TIMEOUT_OUTCOME_UNKNOWN'); error.transactionId = request.transactionId; throw error;
      }
      const identity = { channel: 0, channel_name: 'Granulizer', plugin_valid: true, plugin_name: plugin };
      let result;
      if (operation === 'ping' || operation === 'status') result = {
        selected: identity, pattern: { pattern: 1, pattern_name: 'Pattern 1', length_beats: 4 },
        channel_count: 1, playing: false,
      };
      else if (operation === 'transport.status') result = { playing };
      else if (operation === 'transport.play' || operation === 'transport.stop') {
        const before = playing;
        if (!ignoreWrite) playing = operation === 'transport.play';
        result = { before: { playing: before }, requested: operation === 'transport.play', readback: { playing } };
      }
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

test('parameter trial discovers, mutates, verifies, restores, and retains one complete record', async () => {
  const f = fixture({ initial: 0.5 });
  const result = await run(['plugin', 'trial', '--channel', '0', '--param', '2', '--value', '0.25', '--verify', '--json'], f);
  assert.equal(result.code, 0);
  assert.equal(result.value.kind, 'fl.plugin.parameter.trial');
  assert.equal(result.value.discovery.parameter.name, 'Grain spacing');
  assert.equal(result.value.transactions.mutation.verification.outcome, 'CONFIRMED');
  assert.equal(result.value.transactions.restoration.verification.outcome, 'CONFIRMED');
  assert.equal(result.value.verification.outcome, 'CONFIRMED');
  assert.equal(result.value.verification.externalEffectVerified, false);
  assert.equal(result.value.recovery.blindRetryPermitted, false);
  assert.equal(f.value(), 0.5);
  assert.deepEqual(f.calls.filter(call => call.operation === 'plugin.set').map(call => call.request.arguments.value), [0.25, 0.5]);
});

test('parameter trial reports contradicted mutation and still verifies known-state restoration', async () => {
  const f = fixture({ initial: 0.5, ignoreWrite: true });
  const result = await run(['plugin', 'trial', '--channel', '0', '--param', '2', '--value', '0.25', '--verify', '--json'], f);
  assert.equal(result.code, 1);
  assert.equal(result.value.verification.outcome, 'CONTRADICTED');
  assert.equal(result.value.transactions.mutation.verification.outcome, 'CONTRADICTED');
  assert.equal(result.value.transactions.restoration.verification.outcome, 'CONFIRMED');
  assert.equal(f.value(), 0.5);
});

test('parameter trial retains unknown delivery without speculative restoration', async () => {
  const f = fixture({ initial: 0.5, timeout: true });
  const result = await run(['plugin', 'trial', '--channel', '0', '--param', '2', '--value', '0.25', '--verify', '--json'], f);
  assert.equal(result.code, 1);
  assert.equal(result.value.verification.outcome, 'UNKNOWN');
  assert.equal(result.value.transactions.restoration, null);
  assert.equal(result.value.recovery.restorationAttempted, false);
  assert.equal(result.value.recovery.blindRetryPermitted, false);
  assert.equal(f.calls.filter(call => call.operation === 'plugin.set').length, 1);
});

test('semantic note add compiles step timing and verifies through the unified transaction', async () => {
  let present = false;
  const calls = [];
  const pianoRollAdapter = {
    name: 'fixture-native-piano-roll',
    async observe(target) {
      calls.push({ operation: 'inspect', note: target.note });
      return { value: present, matches: present ? 1 : 0, ppq: 96, observation_source: 'flpianoroll.score.getNote' };
    },
    async invoke(target) {
      calls.push({ operation: 'add', note: target.note }); present = true;
      return { milestones: { RECEIVED: true, ACCEPTED: true, EXECUTED: true } };
    },
  };
  const result = await run(['note', 'add', '--channel', 'Granulizer', '--pattern', '1', '--step', '7',
    '--note', '60', '--velocity', '100', '--verify', '--json'], { ...fixture({ plugin: 'Fruity Granulizer' }), pianoRollAdapter });
  assert.equal(result.code, 0);
  assert.equal(result.value.transaction.schema, 'indro.operation/v1');
  assert.equal(result.value.transaction.verification.outcome, 'CONFIRMED');
  assert.equal(result.value.semantic.step, 7);
  assert.deepEqual(calls.map(call => call.operation), ['inspect', 'add', 'inspect']);
  assert.equal(calls[1].note.time, 144);
  assert.equal(calls[1].note.length, 24);
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

test('transport play and stop require verification and use host readback', async () => {
  assert.equal((await run(['transport', 'play', '--json'], fixture())).code, 1);
  const f = fixture();
  const play = await run(['transport', 'play', '--verify', '--json'], f);
  assert.equal(play.code, 0);
  assert.equal(play.value.transaction.post_observation.value, true);
  assert.equal(play.value.claims.state_transition_observed, true);
  const stop = await run(['transport', 'stop', '--verify', '--json'], f);
  assert.equal(stop.code, 0);
  assert.equal(stop.value.transaction.post_observation.value, false);
});

test('transport timeout and unchanged readback remain non-success', async () => {
  const unchanged = await run(['transport', 'play', '--verify', '--json'], fixture({ ignoreWrite: true }));
  assert.equal(unchanged.code, 1);
  assert.equal(unchanged.value.transaction.verdict, 'READBACK_MISMATCH');
  const timed = await run(['transport', 'play', '--verify', '--json'], fixture({ timeout: true }));
  assert.equal(timed.code, 1);
  assert.equal(timed.value.transaction.verdict, 'TRANSPORT_UNKNOWN');
});
