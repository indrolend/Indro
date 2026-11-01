import test from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const source = readFileSync(fileURLToPath(new URL('./benchmark.mjs', import.meta.url)), 'utf8');
const extracted = source.slice(source.indexOf('function verified('), source.indexOf('\nconst runners'));
assert.ok(extracted.startsWith('function verified(') && extracted.includes('function retained('), 'benchmark functions found');

function run(initial, optimized, { omitPre = false, wrongRestore = false, failSet = false } = {}) {
  let state = initial;
  const commands = [];
  const command = args => {
    const before = state;
    const value = Number(args[args.indexOf('--value') + 1]);
    const isRestore = commands.length > 0;
    state = wrongRestore && isRestore ? 0.9 : value;
    const transaction = {
      verdict: failSet && !isRestore ? 'READBACK_MISMATCH' : 'STATE_CONFIRMED',
      pre_observation: omitPre ? null : { value: before },
      post_observation: { value: state },
    };
    const response = { status: failSet && !isRestore ? 1 : 0,
      json: { code: failSet && !isRestore ? 1 : 0, result: { transaction } }, args };
    commands.push(response);
    return response;
  };
  const context = { command, capability: 'fl.plugin.parameter.grain-spacing', original: 0.5554285714285714 };
  vm.runInNewContext(`${extracted}\nglobalThis.run = retained;`, context);
  const outcome = context.run(0.25, optimized);
  return { state, commands, outcome };
}

for (const optimized of [false, true]) {
  const arm = optimized ? 'C' : 'B';
  test(`${arm} restores actual drifted pre-state`, () => {
    const { state, commands, outcome } = run(0.412, optimized);
    assert.equal(state, 0.412);
    assert.equal(commands.length, 2);
    assert.equal(outcome.success, true);
    assert.equal(outcome.preValue, 0.412);
    assert.equal(outcome.restoredToPre, true);
  });
  test(`${arm} fails closed without a pre-observation`, () => {
    const { commands, outcome } = run(0.412, optimized, { omitPre: true });
    assert.equal(commands.length, 1);
    assert.equal(outcome.success, false);
    assert.equal(outcome.error, 'PRE_STATE_NOT_OBSERVED');
  });
  test(`${arm} rejects a falsely confirmed incorrect restore`, () => {
    const { state, outcome } = run(0.412, optimized, { wrongRestore: true });
    assert.equal(state, 0.9);
    assert.equal(outcome.success, false);
    assert.equal(outcome.restoredToPre, false);
  });
  test(`${arm} attempts restoration after failed set with known pre-state`, () => {
    const { state, commands, outcome } = run(0.412, optimized, { failSet: true });
    assert.equal(state, 0.412);
    assert.equal(commands.length, 2);
    assert.equal(outcome.success, false);
  });
}


test('benchmark preserves historical measurements and creates distinct append-only logs', () => {
  const root = mkdtempSync(join(tmpdir(), 'indro-benchmark-log-'));
  const historical = join(root, 'benchmark-runs.ndjson');
  const historicalBytes = 'HISTORICAL_MEASUREMENTS\n';
  writeFileSync(historical, historicalBytes);
  try {
    const declaration = source.match(/^const output = .*;$/m)?.[0];
    assert.ok(declaration, 'output declaration exists');
    const loop = source.slice(source.indexOf('const runners =')).replace('trial < 10', 'trial < 1');
    assert.ok(loop.includes('trial < 1'), 'bounded synthetic execution');
    let counter = 0;
    const execute = () => {
      const before = new Set(readdirSync(root));
      const outcome = () => ({ calls: [], success: true, probes: 0, discoveryOperations: 0 });
      const context = {
        here: root, resolve, Date, randomUUID: () => `test-${++counter}`,
        appendFileSync, writeFileSync,
        performance: { now: () => 1 }, process: { stdout: { write() {} }, exitCode: 0 },
        conditionA: outcome, retained: outcome,
      };
      vm.runInNewContext(`${declaration}\n${loop}`, context);
      return readdirSync(root).filter(name => !before.has(name));
    };
    const first = execute();
    assert.equal(readFileSync(historical, 'utf8'), historicalBytes, 'historical archive must remain unchanged');
    assert.equal(first.length, 1, 'one fresh evidence file per execution');
    const firstRows = readFileSync(join(root, first[0]), 'utf8').trim().split('\n').map(JSON.parse);
    assert.deepEqual(firstRows.map(row => row.condition), ['A', 'B', 'C']);
    const second = execute();
    assert.equal(second.length, 1, 'second execution has a separate evidence file');
    assert.notEqual(first[0], second[0]);
    assert.equal(readFileSync(historical, 'utf8'), historicalBytes);
    assert.equal(readFileSync(join(root, first[0]), 'utf8').trim().split('\n').length, 3);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

function runDirect(initial, { wrongRestore = false, omitPre = false } = {}) {
  let state = initial;
  let setCount = 0;
  const commands = [];
  const command = args => {
    let json;
    if (args[1] === 'doctor') json = { connected: true };
    else if (args[1] === 'plugins') json = { plugins: [{ plugin_name: 'Fruity Granulizer', channel: 5 }] };
    else if (args[2] === 'params') json = { parameters: [{ name: 'Grain spacing', index: 2 }] };
    else if (args[2] === 'get') json = omitPre ? {} : { value: state };
    else if (args[2] === 'set') {
      setCount += 1;
      state = wrongRestore && setCount === 2 ? 0.9 : Number(args[args.indexOf('--value') + 1]);
      json = { transaction: { verdict: 'STATE_CONFIRMED', post_observation: { value: state } } };
    }
    const result = { status: 0, json, args };
    commands.push(result);
    return result;
  };
  const context = { command };
  vm.runInNewContext(`${extracted}\nglobalThis.run = conditionA;`, context);
  return { state, commands, outcome: context.run(0.25) };
}

test('A restores its observed drifted pre-state', () => {
  const { state, commands, outcome } = runDirect(0.412);
  assert.equal(state, 0.412);
  assert.equal(commands.length, 6);
  assert.equal(outcome.success, true);
  assert.equal(outcome.restoredToPre, true);
});

test('A rejects incorrect restoration despite a success verdict', () => {
  const { state, outcome } = runDirect(0.412, { wrongRestore: true });
  assert.equal(state, 0.9);
  assert.equal(outcome.success, false);
  assert.equal(outcome.restoredToPre, false);
});

test('A rejects missing pre-state without attempting a write', () => {
  const { state, commands, outcome } = runDirect(0.412, { omitPre: true });
  assert.equal(state, 0.412);
  assert.equal(commands.length, 4);
  assert.equal(outcome.success, false);
  assert.equal(outcome.error, 'PRE_STATE_NOT_OBSERVED');
});
