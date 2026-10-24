import { randomUUID, createHash } from 'node:crypto';

export const MILESTONES = Object.freeze(['SUBMITTED','RECEIVED','ACCEPTED','EXECUTED','STATE_CONFIRMED','EFFECT_VERIFIED']);
export const UNKNOWN = 'UNKNOWN';
export function digest(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
export function makeTransaction({ target, capability, args = {}, adapter, verify = 'readback', authorization = 'local' }) {
  if (!target?.app_id || !capability?.id || !adapter?.invoke || !adapter?.observe) throw new TypeError('Explicit target, capability, invoke and observe required');
  return { schema_version: '0.1', operation_id: randomUUID(), target, capability_id: capability.id, arguments: args, authorization,
    transport: adapter.name ?? UNKNOWN, timestamps: { created: new Date().toISOString() },
    milestones: Object.fromEntries(MILESTONES.map(m => [m, UNKNOWN])),
    pre_observation: null, post_observation: null, artifacts: [], contract_id: verify,
    evidence_hashes: [], verdict: UNKNOWN, limitations: [] };
}
export async function executeTransaction(spec) {
  const tx = makeTransaction(spec);
  const { adapter, capability, args = {}, verify = 'readback' } = spec;
  try {
    tx.pre_observation = await adapter.observe(tx.target, capability.id);
    tx.milestones.SUBMITTED = true;
    const result = await adapter.invoke(tx.target, capability, args, { operation_id: tx.operation_id });
    for (const milestone of ['RECEIVED','ACCEPTED','EXECUTED']) {
      if (result?.milestones?.[milestone] === true) tx.milestones[milestone] = true;
    }
    if (result?.error) { tx.verdict = 'EXECUTION_FAILED'; tx.limitations.push(String(result.error)); }
    if (verify === 'readback') {
      tx.post_observation = await adapter.observe(tx.target, capability.id);
      if (result?.expected !== undefined && Object.is(tx.post_observation?.value, result.expected)) {
        tx.milestones.STATE_CONFIRMED = true;
      } else if (result?.expected !== undefined) {
        tx.verdict = 'READBACK_MISMATCH';
      } else {
        tx.limitations.push('No expected state provided for readback comparison');
      }
    }
    if (tx.verdict === UNKNOWN && tx.milestones.STATE_CONFIRMED === true) tx.verdict = 'STATE_CONFIRMED';
    if (tx.verdict === UNKNOWN) tx.limitations.push('Effect not independently verified');
  } catch (error) {
    tx.verdict = 'TRANSPORT_FAILED';
    tx.limitations.push(String(error?.message ?? error));
  }
  tx.timestamps.completed = new Date().toISOString();
  tx.evidence_hashes.push(digest({ ...tx, evidence_hashes: [] }));
  return tx;
}
