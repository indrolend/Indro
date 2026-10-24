import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
const hash = x => createHash('sha256').update(JSON.stringify(x)).digest('hex');
const snapshot = x => structuredClone(x);
const guard = value => { if (value && typeof value.then === 'function') throw new TypeError('Async transitions unsupported'); return value; };
/** Bounded comparison only; never a general proof or reusable certificate. */
export function assay({ initialStates, inputs, left, right, project = x => x, equal = isDeepStrictEqual, maxCases = 10000, projectionId, comparatorId }) {
  if (!Array.isArray(initialStates) || !Array.isArray(inputs) || !initialStates.length || !inputs.length) throw new TypeError('Nonempty states and inputs required');
  if ([left,right,project,equal].some(f => typeof f !== 'function')) throw new TypeError('Functions required');
  if (!Number.isSafeInteger(maxCases) || maxCases < 1) throw new TypeError('Invalid bound');
  const cases = initialStates.length * inputs.length;
  if (!Number.isSafeInteger(cases) || cases > maxCases) return { verdict:'UNKNOWN', reason:'BOUND_EXCEEDED', cases:0 };
  const identified = typeof projectionId === 'string' && projectionId.length > 0 && typeof comparatorId === 'string' && comparatorId.length > 0;
  // IDs are caller assertions, not authenticated function identities. Never reuse as a proof certificate.
  const contract_hash = identified ? hash({ initialStates, inputs, maxCases, projectionId, comparatorId }) : null;
  let checked = 0;
  for (const initial of initialStates) for (const input of inputs) {
    let a,b,match;
    try {
      a = guard(project(guard(left(snapshot(initial), snapshot(input)))));
      b = guard(project(guard(right(snapshot(initial), snapshot(input)))));
      match = guard(equal(a,b));
      if (typeof match !== 'boolean') throw new TypeError('Comparator must return boolean');
    } catch (error) { return { verdict:'UNKNOWN', reason:'EXECUTION_ERROR', error:String(error?.message ?? error), checked, contract_hash }; }
    checked++;
    if (!match) return { verdict:'COUNTEREXAMPLE', checked, contract_hash, witness:{initial,input,left:a,right:b} };
  }
  return { verdict:'PROVEN_EQUIVALENT', scope:'enumerated finite cases only', checked, contract_hash, reusable_certificate:false };
}
