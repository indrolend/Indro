import { createHash } from 'node:crypto';

const hash = x => createHash('sha256').update(JSON.stringify(x)).digest('hex');
const snapshot = x => structuredClone(x);

/**
 * A bounded assay of observable state transitions. Not source recovery,
 * genome reconstruction, or a general equivalence proof.
 */
export function assay({ initialStates, inputs, left, right, project = x => x, equal = (a, b) => Object.is(JSON.stringify(a), JSON.stringify(b)), maxCases = 10000 }) {
  if (!Array.isArray(initialStates) || !Array.isArray(inputs) || !initialStates.length || !inputs.length) throw new TypeError('Nonempty finite states and inputs required');
  if (typeof left !== 'function' || typeof right !== 'function' || typeof project !== 'function' || typeof equal !== 'function') throw new TypeError('Transition and observation functions required');
  if (!Number.isSafeInteger(maxCases) || maxCases < 1) throw new TypeError('Invalid bound');
  const cases = initialStates.length * inputs.length;
  if (!Number.isSafeInteger(cases) || cases > maxCases) return { verdict: 'UNKNOWN', reason: 'BOUND_EXCEEDED', cases: 0 };
  const contract = { initialStates, inputs, maxCases, projection: 'caller-provided', comparator: 'caller-provided' };
  const contract_hash = hash(contract);
  let checked = 0;
  for (const initial of initialStates) {
    for (const input of inputs) {
      let a, b;
      try {
        a = project(awaitableGuard(left(snapshot(initial), snapshot(input))));
        b = project(awaitableGuard(right(snapshot(initial), snapshot(input))));
      } catch (error) {
        return { verdict: 'UNKNOWN', reason: 'EXECUTION_ERROR', error: String(error?.message ?? error), checked, contract_hash };
      }
      checked++;
      if (!equal(a, b)) return { verdict: 'COUNTEREXAMPLE', checked, contract_hash, witness: { initial, input, left: a, right: b } };
    }
  }
  return { verdict: 'PROVEN_EQUIVALENT', scope: 'enumerated finite cases only', checked, contract_hash };
}
function awaitableGuard(value) {
  if (value && typeof value.then === 'function') throw new TypeError('Async transitions unsupported in synchronous assay');
  return value;
}
