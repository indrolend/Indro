import test from 'node:test';
import assert from 'node:assert/strict';
import { assay } from './assay.mjs';

const states = [{ charge: 0 }, { charge: 2 }];
const inputs = [0, 1, 3];
const baseline = (s, x) => ({ charge: s.charge + x, internal: 'native' });
test('observationally equivalent implementations can differ internally', () => {
  const alternative = (s, x) => ({ charge: x + s.charge, internal: 'ported' });
  const result = assay({ initialStates: states, inputs, left: baseline, right: alternative, project: x => x.charge });
  assert.equal(result.verdict, 'PROVEN_EQUIVALENT');
  assert.equal(result.checked, 6);
  assert.equal(result.scope, 'enumerated finite cases only');
});
test('mutation generates a concrete counterexample', () => {
  const mutant = (s, x) => ({ charge: s.charge + x * 2 });
  const result = assay({ initialStates: states, inputs, left: baseline, right: mutant, project: x => x.charge });
  assert.equal(result.verdict, 'COUNTEREXAMPLE');
  assert.equal(result.witness.input, 1);
});
test('bound exhaustion is unknown rather than proof', () => {
  const result = assay({ initialStates: states, inputs, left: baseline, right: baseline, maxCases: 2 });
  assert.equal(result.verdict, 'UNKNOWN');
});
test('execution error is unknown', () => {
  const result = assay({ initialStates: states, inputs, left: () => { throw Error('boom'); }, right: baseline });
  assert.equal(result.verdict, 'UNKNOWN');
});
test('inputs and states are isolated between implementations', () => {
  const mutate = (s, x) => { s.charge++; return s.charge + x; };
  const pure = (s, x) => s.charge + x + 1;
  assert.equal(assay({ initialStates: states, inputs, left: mutate, right: pure }).verdict, 'PROVEN_EQUIVALENT');
  assert.deepEqual(states, [{ charge: 0 }, { charge: 2 }]);
});
