import test from 'node:test';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { persistFlReceipt } from '../fl/adapter.mjs';
import { png } from '../paint/png-fixture.test-helper.mjs';
import { invokeCapability, listCapabilities, loadCapability, retainFlParameterCapability, retainPaintResizeCapability, validateCapability } from './store.mjs';


function fixture({ channel = 5, parameter = 2, plugin = 'Fruity granulizer', parameterName = 'Grain spacing' } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'indro-capability-'));
  const mailbox = join(root, 'controller', 'indro-mailbox');
  mkdirSync(join(mailbox, 'requests'), { recursive: true });
  mkdirSync(join(mailbox, 'responses'), { recursive: true });
  writeFileSync(join(dirname(mailbox), 'device_FLGranulizerBridge.py'), 'bridge-v1');
  const session = { schema: 'indro.fl.bridge.v1', bridge_version: '1', session_id: 'session-1', process_id: process.pid, heartbeat_unix_ms: Date.now() };
  writeFileSync(join(mailbox, 'session.json'), JSON.stringify(session));
  const receipt = persistFlReceipt({ transaction: {
    operation_id: 'source-op', capability_id: 'fl.plugin.parameter', verdict: 'STATE_CONFIRMED',
    target: { session_id: 'session-1', channel, plugin_name: plugin, parameter },
    milestones: { STATE_CONFIRMED: true },
    post_observation: { channel, plugin_name: plugin, parameter, parameter_name: parameterName, value: 0.5 },
  } }, { evidenceRoot: join(root, 'receipts') });
  const options = { capabilityRoot: join(root, 'capabilities'), mailbox, receiptPath: receipt.path };
  const retained = retainFlParameterCapability(options);
  return { root, mailbox, session, options, retained, id: retained.capability.id, channel, parameter, plugin, parameterName };
}

function transport(f, overrides = {}) {
  return { name: 'fixture', async request(operation) {
    if (overrides.timeout) throw new Error('FL_RESPONSE_TIMEOUT_OUTCOME_UNKNOWN');
    let result;
    if (operation === 'status') result = { selected: { channel: f.channel } };
    else if (operation === 'plugins.list') result = { plugins: overrides.plugins ?? [{ channel: overrides.channel ?? f.channel, plugin_name: overrides.plugin ?? f.plugin, plugin_valid: true }] };
    else if (operation === 'plugin.params') result = { parameters: overrides.parameters ?? [{ index: overrides.parameter ?? f.parameter, name: overrides.parameterName ?? f.parameterName, value: 0.5 }] };
    else result = {};
    return { response: { result } };
  } };
}

const validationOptions = (f, extra = {}) => ({ ...f.options, discoverSession: () => f.session, transport: transport(f), ...extra });

test('retains an immutable FL capability and fresh process can list and load it', () => {
  const f = fixture();
  assert.equal(listCapabilities(f.options)[0].id, f.id);
  assert.equal(loadCapability(f.id, f.options).target.parameter_name, 'Grain spacing');
  assert.match(readFileSync(f.retained.path, 'utf8'), /checksum integrity is not authenticated provenance/);
});

test('correct capability resolves current target and changed mapping by names', async () => {
  const f = fixture();
  const current = await validateCapability(f.id, validationOptions(f));
  assert.equal(current.valid, true); assert.equal(current.mapping_changed, false);
  const moved = await validateCapability(f.id, validationOptions(f, { transport: transport(f, { channel: 8, parameter: 7 }) }));
  assert.equal(moved.valid, true); assert.equal(moved.mapping_changed, true);
  assert.deepEqual([moved.resolved_target.channel, moved.resolved_target.parameter], [8, 7]);
});

test('wrong application, plugin, and absent parameter identity reject reuse', async () => {
  const f = fixture();
  const path = f.retained.path; const value = JSON.parse(readFileSync(path, 'utf8'));
  value.payload.target.application = 'other';
  const crypto = await import('node:crypto'); value.integrity.digest = crypto.createHash('sha256').update(JSON.stringify(value.payload)).digest('hex');
  writeFileSync(path, JSON.stringify(value));
  assert.match((await validateCapability(f.id, validationOptions(f))).issues.join(','), /WRONG_APPLICATION/);
  const p = fixture();
  assert.match((await validateCapability(p.id, validationOptions(p, { transport: transport(p, { plugin: 'Sytrus' }) }))).issues.join(','), /TARGET_IDENTITY_NOT_FOUND/);
  assert.match((await validateCapability(p.id, validationOptions(p, { transport: transport(p, { parameterName: 'Other' }) }))).issues.join(','), /TARGET_IDENTITY_NOT_FOUND/);
});

test('corruption and incompatible schema fail before reuse', () => {
  const corrupt = fixture();
  const value = JSON.parse(readFileSync(corrupt.retained.path, 'utf8')); value.payload.goal = 'tampered'; writeFileSync(corrupt.retained.path, JSON.stringify(value));
  assert.throws(() => loadCapability(corrupt.id, corrupt.options), /CHECKSUM_MISMATCH/);
  const schema = fixture(); const changed = JSON.parse(readFileSync(schema.retained.path, 'utf8')); changed.payload.schema = 'indro.capability/v999'; writeFileSync(schema.retained.path, JSON.stringify(changed));
  assert.throws(() => loadCapability(schema.id, schema.options), /INCOMPATIBLE/);
});

test('stale adapter and bridge fingerprints reject reuse', async () => {
  const f = fixture();
  writeFileSync(join(dirname(f.mailbox), 'device_FLGranulizerBridge.py'), 'changed');
  assert.match((await validateCapability(f.id, validationOptions(f))).issues.join(','), /INSTALLED_BRIDGE_FINGERPRINT_MISMATCH/);
  const adapter = fixture();
  const value = JSON.parse(readFileSync(adapter.retained.path, 'utf8'));
  value.payload.dependencies.adapter.sha256 = '0'.repeat(64);
  const crypto = await import('node:crypto'); value.integrity.digest = crypto.createHash('sha256').update(JSON.stringify(value.payload)).digest('hex');
  writeFileSync(adapter.retained.path, JSON.stringify(value));
  assert.match((await validateCapability(adapter.id, validationOptions(adapter))).issues.join(','), /ADAPTER_FINGERPRINT_MISMATCH/);
});

test('authorization, value, verify, unchanged state, and timeout remain fail closed', async () => {
  const f = fixture();
  await assert.rejects(invokeCapability(f.id, 0.25, validationOptions(f)), /NOT_AUTHORIZED/);
  await assert.rejects(invokeCapability(f.id, 2, { ...validationOptions(f), authorization: 'explicit-user-write' }), /VALUE_OUT_OF_RANGE/);
  const base = { ...validationOptions(f), authorization: 'explicit-user-write' };
  const satisfied = await invokeCapability(f.id, 0.5, { ...base, runFlCli: async (_args, out) => { out(JSON.stringify({ transaction: { verdict: 'STATE_CONFIRMED', state_transition_observed: false } })); return 0; } });
  assert.equal(satisfied.result.transaction.state_transition_observed, false);
  const unchanged = await invokeCapability(f.id, 0.25, { ...base, runFlCli: async (_args, out) => { out(JSON.stringify({ transaction: { verdict: 'READBACK_MISMATCH' } })); return 1; } });
  assert.equal(unchanged.code, 1);
  await assert.rejects(validateCapability(f.id, validationOptions(f, { transport: transport(f, { timeout: true }) })), /TIMEOUT_OUTCOME_UNKNOWN/);
});

test('retains Paint artifact capability in Continuum and validates exact application identity', async () => {
  const root = mkdtempSync(join(tmpdir(), 'indro-paint-capability-'));
  const artifactPath = join(root, 'verified.png');
  writeFileSync(artifactPath, png(320, 240));
  const options = { capabilityRoot: join(root, 'capabilities') };
  const retained = retainPaintResizeCapability({ ...options, artifactPath, width: 320, height: 240, appVersion: '11.2605.81.0' });
  assert.equal(listCapabilities(options)[0].id, 'paint.canvas.resize-and-export-png');
  const valid = await validateCapability(retained.capability.id, { ...options, paintAppVersion: '11.2605.81.0' });
  assert.equal(valid.valid, true);
  assert.equal(valid.invocation.autonomous, false);
  assert.deepEqual((await validateCapability(retained.capability.id, options)).issues, ['PAINT_IDENTITY_UNVERIFIED']);
  assert.deepEqual((await validateCapability(retained.capability.id, { ...options, paintAppVersion: '12' })).issues, ['PAINT_VERSION_MISMATCH']);
  writeFileSync(artifactPath, png(321, 240));
  assert.match((await validateCapability(retained.capability.id, { ...options, paintAppVersion: '11.2605.81.0' })).issues.join(','), /EVIDENCE_WIDTH_MISMATCH|EVIDENCE_ARTIFACT_DIGEST_MISMATCH/);
});

test('changed or missing source receipt rejects FL reuse before any host probe or write', async () => {
  const changed = fixture();
  const before = await validateCapability(changed.id, validationOptions(changed));
  assert.equal(before.valid, true);
  const receiptPath = changed.retained.capability.evidence[0].receipt;
  writeFileSync(receiptPath, readFileSync(receiptPath, 'utf8') + '\n');
  let probes = 0;
  let writes = 0;
  const noProbe = { name: 'negative-control', async request() { probes++; throw new Error('UNEXPECTED_HOST_PROBE'); } };
  const options = validationOptions(changed, { transport: noProbe });
  const invalid = await validateCapability(changed.id, options);
  assert.deepEqual(invalid.issues, ['SOURCE_RECEIPT_FINGERPRINT_MISMATCH']);
  assert.equal(invalid.reusable, false);
  await assert.rejects(
    invokeCapability(changed.id, 0.25, {
      ...options, authorization: 'explicit-user-write',
      runFlCli: async () => { writes++; throw new Error('UNEXPECTED_HOST_WRITE'); },
    }),
    /CAPABILITY_NOT_REUSABLE:SOURCE_RECEIPT_FINGERPRINT_MISMATCH/
  );
  assert.equal(probes, 0);
  assert.equal(writes, 0);
  const missing = fixture();
  unlinkSync(missing.retained.capability.evidence[0].receipt);
  const unavailable = await validateCapability(missing.id, validationOptions(missing, { transport: noProbe }));
  assert.deepEqual(unavailable.issues, ['SOURCE_RECEIPT_UNAVAILABLE']);
  assert.equal(unavailable.reusable, false);
  assert.equal(probes, 0);
});

test('fresh Node process reuses retained FL capability and rejects stale source before simulated write', () => {
  const f = fixture();
  const moduleUrl = new URL('./store.mjs', import.meta.url).href;
  const childSource = [
    'import { invokeCapability, listCapabilities } from ' + JSON.stringify(moduleUrl) + ';',
    'const [capabilityRoot, mailbox, id, sessionText] = process.argv.slice(1);',
    'const session = JSON.parse(sessionText);',
    'let probes = 0, writes = 0;',
    'const transport = { name: "fresh-process-fixture", async request(operation) {',
    '  probes++;',
    '  const result = operation === "status" ? { selected: { channel: 5 } } :',
    '    operation === "plugins.list" ? { plugins: [{ channel: 5, plugin_name: "Fruity granulizer", plugin_valid: true }] } :',
    '    { parameters: [{ index: 2, name: "Grain spacing", value: 0.5 }] };',
    '  return { response: { result } };',
    '} };',
    'try {',
    '  const invoked = await invokeCapability(id, 0.25, {',
    '    capabilityRoot, mailbox, discoverSession: () => session, transport, authorization: "explicit-user-write",',
    '    runFlCli: async (args, out) => {',
    '      writes++;',
    '      if (args.join(" ") !== "plugin set --channel 5 --param 2 --value 0.25 --verify --json") throw new Error("WRONG_TARGET");',
    '      out(JSON.stringify({ transaction: { verdict: "STATE_CONFIRMED", state_transition_observed: true } }));',
    '      return 0;',
    '    },',
    '  });',
    '  console.log(JSON.stringify({ code: invoked.code, verdict: invoked.result.transaction.verdict, probes, writes, ids: listCapabilities({ capabilityRoot }).map(x => x.id) }));',
    '} catch (error) {',
    '  console.log(JSON.stringify({ error: error.message, probes, writes, ids: listCapabilities({ capabilityRoot }).map(x => x.id) }));',
    '  process.exitCode = 1;',
    '}',
  ].join('\n');
  const run = (root = f.options.capabilityRoot) => {
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', childSource, root, f.mailbox, f.id, JSON.stringify(f.session)], { encoding: 'utf8' });
    assert.equal(child.error, undefined);
    assert.ok(child.stdout.trim(), child.stderr);
    return { status: child.status, ...JSON.parse(child.stdout.trim()) };
  };
  const reused = run();
  assert.equal(reused.status, 0);
  assert.equal(reused.verdict, 'STATE_CONFIRMED');
  assert.equal(reused.probes, 3);
  assert.equal(reused.writes, 1);
  assert.deepEqual(reused.ids, [f.id]);
  const noMemory = run(join(f.root, 'empty-capability-root'));
  assert.equal(noMemory.status, 1);
  assert.match(noMemory.error, /CAPABILITY_NOT_FOUND/);
  assert.equal(noMemory.probes, 0);
  assert.equal(noMemory.writes, 0);
  const receiptPath = f.retained.capability.evidence[0].receipt;
  writeFileSync(receiptPath, readFileSync(receiptPath, 'utf8') + '\n');
  const stale = run();
  assert.equal(stale.status, 1);
  assert.match(stale.error, /CAPABILITY_NOT_REUSABLE:SOURCE_RECEIPT_FINGERPRINT_MISMATCH/);
  assert.equal(stale.probes, 0);
  assert.equal(stale.writes, 0);
});

test('retained FL invocation carries the verified parameter name to the host write boundary', async () => {
  const f = fixture();
  let received = null;
  const result = await invokeCapability(f.id, 0.25, {
    ...validationOptions(f), authorization: 'explicit-user-write',
    runFlCli: async (_args, out, _err, dependencies) => {
      received = dependencies.expectedParameterName;
      out(JSON.stringify({ transaction: { verdict: 'STATE_CONFIRMED' } }));
      return 0;
    },
  });
  assert.equal(result.code, 0);
  assert.equal(received, 'Grain spacing');
});

test('M2 fresh-process retained reuse and no-memory baseline execute full FL CLI transactions', () => {
  const f = fixture();
  const moduleUrl = new URL('./store.mjs', import.meta.url).href;
  const flUrl = new URL('../fl/cli.mjs', import.meta.url).href;
  const childSource = `
    import { existsSync } from 'node:fs';
    import { join } from 'node:path';
    import { invokeCapability } from ${JSON.stringify(moduleUrl)};
    import { runFlCli } from ${JSON.stringify(flUrl)};
    const [capabilityRoot, mailbox, id, sessionText, mode] = process.argv.slice(1);
    const session = JSON.parse(sessionText);
    let value = 0.5, writes = 0, error = null, code = 1, verdict = null, persisted = false;
    const operations = [];
    const identity = { channel: 5, channel_name: 'Granulizer', plugin_valid: true, plugin_name: 'Fruity granulizer' };
    const transport = { name: 'full-path-fixture', async request(operation, request = {}) {
      operations.push(operation);
      let result;
      if (operation === 'status') result = { selected: { channel: 5 } };
      else if (operation === 'plugins.list') result = { plugins: [identity] };
      else if (operation === 'plugin.params') result = { parameters: [{ index: 2, name: 'Grain spacing', value }] };
      else if (operation === 'plugin.inspect') result = { ...identity, plugin_name: mode === 'retained-race' ? 'Sytrus' : identity.plugin_name, parameter_count: 103 };
      else if (operation === 'plugin.get') {
        if (request.target?.parameter_name && request.target.parameter_name !== 'Grain spacing') throw Error('WRONG_PARAMETER');
        result = { ...identity, parameter: 2, parameter_name: 'Grain spacing', value };
      } else if (operation === 'plugin.set') {
        if (request.authorization !== 'explicit-user-write' || request.target?.channel !== 5 ||
            request.target?.parameter !== 2 || request.target?.plugin_name !== 'Fruity granulizer' ||
            (request.target?.parameter_name && request.target.parameter_name !== 'Grain spacing')) throw Error('WRONG_WRITE_TARGET');
        value = request.arguments.value;
        writes++;
        result = { value };
      } else throw Error('UNEXPECTED_HOST_OPERATION:' + operation);
      return { response: { result, received_unix_ms: Date.now(), accepted: true, executed: true } };
    } };
    const common = { capabilityRoot, mailbox, discoverSession: () => session, transport,
      evidenceRoot: join(mailbox, '..', '..', 'execution-receipts') };
    const started = process.hrtime.bigint();
    try {
      let record;
      if (mode === 'retained' || mode === 'retained-race') {
        const invoked = await invokeCapability(id, 0.25, { ...common, authorization: 'explicit-user-write' });
        code = invoked.code;
        record = invoked.result;
      } else if (mode === 'baseline') {
        const status = (await transport.request('status')).response.result;
        const plugins = (await transport.request('plugins.list')).response.result.plugins
          .filter(item => item.plugin_name === 'Fruity granulizer');
        if (plugins.length !== 1) throw Error('AMBIGUOUS_PLUGIN');
        const params = (await transport.request('plugin.params')).response.result.parameters
          .filter(item => item.name === 'Grain spacing');
        if (params.length !== 1 || status.selected.channel !== 5) throw Error('AMBIGUOUS_OR_WRONG_TARGET');
        const output = [];
        code = await runFlCli(['plugin', 'set', '--channel', String(plugins[0].channel),
          '--param', String(params[0].index), '--value', '0.25', '--verify', '--json'],
          line => output.push(line), () => {}, common);
        record = JSON.parse(output.at(-1));
      } else throw Error('INVALID_MODE');
      verdict = record?.transaction?.verdict ?? null;
      error = record?.error ?? null;
      persisted = Boolean(record?.evidence?.path && existsSync(record.evidence.path));
    } catch (caught) { code = 1; error = caught.message; }
    const observed = code === 0
      ? (await transport.request('plugin.get', { target: { channel: 5, parameter: 2 } })).response.result.value
      : null;
    const elapsed_ms = Number(process.hrtime.bigint() - started) / 1e6;
    console.log(JSON.stringify({ mode, code, verdict, error, operations, writes, observed, persisted, elapsed_ms }));
  `;
  const run = mode => {
    const started = process.hrtime.bigint();
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', childSource,
      f.options.capabilityRoot, f.mailbox, f.id, JSON.stringify(f.session), mode], { encoding: 'utf8' });
    assert.equal(child.status, 0, child.stderr);
    return { ...JSON.parse(child.stdout.trim()), wall_ms: Number(process.hrtime.bigint() - started) / 1e6 };
  };
  const retained = Array.from({ length: 5 }, () => run('retained'));
  const baseline = Array.from({ length: 5 }, () => run('baseline'));
  const expected = ['status', 'plugins.list', 'plugin.params', 'plugin.inspect',
    'plugin.get', 'plugin.set', 'plugin.get', 'plugin.get'];
  for (const result of [...retained, ...baseline]) {
    assert.equal(result.code, 0, result.error);
    assert.equal(result.verdict, 'STATE_CONFIRMED');
    assert.equal(result.observed, 0.25);
    assert.equal(result.persisted, true);
    assert.equal(result.writes, 1);
    assert.deepEqual(result.operations, expected);
  }
  const replacement = run('retained-race');
  assert.equal(replacement.code, 1);
  assert.equal(replacement.error, 'WRONG_PLUGIN_IDENTITY');
  assert.equal(replacement.writes, 0);
  assert.deepEqual(replacement.operations, expected.slice(0, 4));
  const receiptPath = f.retained.capability.evidence[0].receipt;
  writeFileSync(receiptPath, readFileSync(receiptPath, 'utf8') + '\\n');
  const stale = run('retained');
  assert.equal(stale.code, 1);
  assert.match(stale.error, /SOURCE_RECEIPT_FINGERPRINT_MISMATCH/);
  assert.equal(stale.writes, 0);
  assert.deepEqual(stale.operations, []);
  const median = (values, key) => values.map(x => x[key]).sort((a, b) => a - b)[2];
  console.log('M2_FULL_PATH_COST ' + JSON.stringify({
    retained_median_ms: median(retained, 'elapsed_ms'),
    no_memory_median_ms: median(baseline, 'elapsed_ms'),
    retained_wall_median_ms: median(retained, 'wall_ms'),
    no_memory_wall_median_ms: median(baseline, 'wall_ms'),
    retained_host_requests: expected.length, no_memory_host_requests: expected.length,
    retained_writes: 1, no_memory_writes: 1, successful_trials: retained.length + baseline.length,
    negative_controls: ['wrong-plugin-before-write', 'stale-receipt-before-host-probe'],
    limitation: 'controlled transport, not live FL Studio; session-A discovery and retention cost excluded'
  }));
});

test('different FL plugins sharing a parameter name remain independently addressable', () => {
  const f = fixture({ plugin: 'Fruity granulizer', parameterName: 'Mix' });
  const otherReceipt = persistFlReceipt({ transaction: {
    operation_id: 'source-op-sytrus', capability_id: 'fl.plugin.parameter', verdict: 'STATE_CONFIRMED',
    target: { session_id: 'session-1', channel: 6, plugin_name: 'Sytrus', parameter: 4 },
    milestones: { STATE_CONFIRMED: true },
    post_observation: { channel: 6, plugin_name: 'Sytrus', parameter: 4, parameter_name: 'Mix', value: 0.5 },
  } }, { evidenceRoot: join(f.root, 'receipts') });
  const other = retainFlParameterCapability({ ...f.options, receiptPath: otherReceipt.path });
  assert.notEqual(f.id, other.capability.id, 'different plugin identities must not share a capability ID');
  assert.deepEqual(listCapabilities(f.options).map(x => x.id).sort(), [f.id, other.capability.id].sort());
  assert.equal(loadCapability(f.id, f.options).target.plugin_name, 'Fruity granulizer');
  assert.equal(loadCapability(other.capability.id, f.options).target.plugin_name, 'Sytrus');
});

test('legacy parameter-only capability IDs remain readable without rewriting retained records', () => {
  const f = fixture();
  const legacyId = 'fl.plugin.parameter.grain-spacing';
  const legacy = JSON.parse(readFileSync(f.retained.path, 'utf8'));
  legacy.payload.id = legacyId;
  legacy.integrity.digest = createHash('sha256').update(JSON.stringify(legacy.payload)).digest('hex');
  const legacyDir = join(f.options.capabilityRoot, legacyId);
  mkdirSync(legacyDir, { recursive: true });
  writeFileSync(join(legacyDir, 'historical.json'), JSON.stringify(legacy));
  assert.equal(loadCapability(legacyId, f.options).target.plugin_name, f.plugin);
  assert.deepEqual(listCapabilities(f.options).map(x => x.id).sort(), [legacyId, f.id].sort());
});
