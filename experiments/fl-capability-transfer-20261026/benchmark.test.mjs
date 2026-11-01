import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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
