import { randomUUID, createHash } from 'node:crypto';
import { OPERATION_CONTRACT_SCHEMA } from '../../commandhud/operation-contract.mjs';

export const MILESTONES = Object.freeze(['SUBMITTED', 'RECEIVED', 'ACCEPTED', 'EXECUTED', 'STATE_CONFIRMED', 'EFFECT_VERIFIED']);
export const UNKNOWN = 'UNKNOWN';
export const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

export function makeTransaction({ target, capability, args = {}, adapter, verify = 'readback', authorization = 'local' }) {
  if (!target?.app_id || !capability?.id || typeof adapter?.invoke !== 'function' || typeof adapter?.observe !== 'function') {
    throw new TypeError('Explicit target, capability, invoke and observe required');
  }
  const operationId = randomUUID();
  const expectedPostcondition = verify === 'readback' && Object.hasOwn(args, 'value')
    ? { kind: 'application-readback', capability: capability.id, equals: args.value }
    : { kind: verify };
  return {
    schema: OPERATION_CONTRACT_SCHEMA,
    schema_version: '0.1', operation_id: operationId, operationId, target,
    principal: { type: 'human', id: 'local-user' },
    capability: { id: capability.id, version: 1 }, capability_id: capability.id, arguments: args,
    authorization: {
      decision: UNKNOWN, basis: authorization, enforced: false,
      scope: { target: target.app_id, capability: capability.id },
    },
    environment: { transport: adapter.name ?? UNKNOWN }, transport: adapter.name ?? UNKNOWN,
    timestamps: { created: new Date().toISOString() },
    milestones: Object.fromEntries(MILESTONES.map(m => [m, UNKNOWN])),
    pre_observation: null, post_observation: null, artifacts: [], contract_id: verify,
    invocation: {
      attempted: false, submitted: UNKNOWN, acceptedByTarget: UNKNOWN,
      executed: UNKNOWN, executionEvidence: UNKNOWN,
    },
    observations: { before: null, after: null },
    expectedPostcondition,
    verification: {
      outcome: UNKNOWN, observed: null, assurance: verify === 'readback' ? 'application-readback' : verify,
      externalEffectVerified: false,
    },
    evidence: { integrity: 'sha256-checksum-not-authenticated' },
    recovery: { state: 'IN_PROGRESS', blindRetryPermitted: false },
    reuse: { eligible: false, reason: 'Capability validity has not been established for reuse.' },
    evidence_hashes: [], verdict: UNKNOWN,
    limitations: ['Authorization policy was declared by the caller but not independently enforced by the UAI transaction kernel.']
  };
}

function finalizeContract(tx) {
  tx.invocation = {
    attempted: tx.milestones.SUBMITTED === true,
    submitted: tx.milestones.SUBMITTED,
    acceptedByTarget: tx.milestones.ACCEPTED,
    executed: tx.milestones.EXECUTED,
    executionEvidence: tx.milestones.EXECUTED === true ? 'adapter-reported-execution' : UNKNOWN,
  };
  tx.observations = { before: tx.pre_observation, after: tx.post_observation };
  tx.verification = {
    ...tx.verification,
    outcome: tx.verdict === 'STATE_CONFIRMED' ? 'CONFIRMED'
      : tx.verdict === 'READBACK_MISMATCH' ? 'CONTRADICTED' : UNKNOWN,
    observed: tx.post_observation,
  };
  tx.recovery = {
    state: ['TRANSPORT_UNKNOWN', 'OBSERVATION_FAILED'].includes(tx.verdict) ? 'OUTCOME_UNKNOWN' : 'FINALIZED',
    blindRetryPermitted: false,
  };
}

export async function executeTransaction(spec) {
  const tx = makeTransaction(spec);
  const { adapter, capability, args = {}, verify = 'readback' } = spec;
  let stage = 'pre_observation';
  try {
    tx.pre_observation = await adapter.observe(tx.target, capability.id);
    stage = 'invoke';
    // SUBMITTED means the invocation was attempted, not that the application received it.
    tx.milestones.SUBMITTED = true;
    const result = await adapter.invoke(tx.target, capability, args, {
      operation_id: tx.operation_id,
      authorization: tx.authorization
    });
    for (const milestone of ['RECEIVED', 'ACCEPTED', 'EXECUTED']) {
      if (result?.milestones?.[milestone] === true) tx.milestones[milestone] = true;
    }
    if (result?.error) {
      tx.verdict = 'EXECUTION_FAILED';
      tx.limitations.push(String(result.error));
    } else if (verify === 'readback') {
      stage = 'post_observation';
      tx.post_observation = await adapter.observe(tx.target, capability.id);
      // An adapter-provided expected value is not sufficient authority for a successful mutation.
      // Readback is a comparison against the caller's declared expectation.
      if (!Object.hasOwn(args, 'value')) {
        tx.limitations.push('No caller-provided expected value');
      } else {
        const actual = tx.post_observation?.value;
        const expected = args.value;
        const tolerance = spec.tolerance ?? 0;
        if (typeof tolerance !== 'number' || !Number.isFinite(tolerance) || tolerance < 0) {
          throw new TypeError('Invalid comparison tolerance');
        }
        const equal = typeof actual === 'number' && typeof expected === 'number'
          ? Number.isFinite(actual) && Number.isFinite(expected) && Math.abs(actual - expected) <= tolerance
          : Object.is(actual, expected);
        if (equal) {
          tx.milestones.STATE_CONFIRMED = true;
          tx.state_transition_observed = !Object.is(tx.pre_observation?.value, actual);
        }
        else tx.verdict = 'READBACK_MISMATCH';
      }
    }
    if (tx.verdict === UNKNOWN && tx.milestones.STATE_CONFIRMED === true) tx.verdict = 'STATE_CONFIRMED';
    if (tx.milestones.EFFECT_VERIFIED !== true) tx.limitations.push('Independent effect not verified');
  } catch (error) {
    tx.verdict = stage === 'invoke' ? 'TRANSPORT_UNKNOWN' : 'OBSERVATION_FAILED';
    tx.limitations.push(String(error?.message ?? error));
  }
  tx.timestamps.completed = new Date().toISOString();
  finalizeContract(tx);
  // Integrity checksum only; durable, append-only storage belongs to CommandHUD.
  tx.evidence_hashes.push(digest({ ...tx, evidence_hashes: [] }));
  return tx;
}
