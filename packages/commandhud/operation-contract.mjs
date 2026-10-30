import { isAbsolute, relative, resolve } from 'node:path';

export const OPERATION_CONTRACT_SCHEMA = 'indro.operation/v1';
export const UNKNOWN = 'UNKNOWN';

function contained(root, path) {
  const value = relative(resolve(root), resolve(path));
  return value === '' || (!isAbsolute(value) && value !== '..' && !value.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`));
}

export function localArgvOperation(project, argv, {
  cwd = project.root,
  objective = null,
  principal = 'local-user',
  expectedPostcondition = { kind: 'process-exit-code', equals: 0 },
} = {}) {
  return {
    schema: OPERATION_CONTRACT_SCHEMA,
    principal: { type: 'human', id: principal },
    target: { type: 'git-repository', id: project.identity.id, root: project.root },
    capability: { id: 'process.argv', version: 1 },
    arguments: { argv: [...argv] },
    authorization: {
      decision: 'ALLOW',
      basis: 'verified-local-cli',
      scope: { target: project.identity.id, capability: 'process.argv' },
    },
    environment: { cwd },
    objective,
    expectedPostcondition,
  };
}

export function validateOperationRequest(project, request) {
  if (request?.schema !== OPERATION_CONTRACT_SCHEMA) throw new Error('Unsupported operation contract schema.');
  if (!request.principal?.id || request.principal.type !== 'human') throw new Error('Operation requires an identified human principal.');
  if (request.target?.type !== 'git-repository' || request.target.id !== project.identity.id
    || resolve(request.target.root || '') !== resolve(project.root)) throw new Error('Operation target does not match the verified repository.');
  if (request.capability?.id !== 'process.argv' || request.capability.version !== 1) throw new Error('Operation capability is unsupported.');
  const argv = request.arguments?.argv;
  if (!Array.isArray(argv) || argv.length < 1 || argv.length > 64
    || argv.some((value) => typeof value !== 'string' || !value || value.length > 32768 || /[\0\r\n]/.test(value))) {
    throw new Error('Operation requires 1 to 64 bounded argument strings.');
  }
  if (request.authorization?.decision !== 'ALLOW'
    || request.authorization?.scope?.target !== project.identity.id
    || request.authorization?.scope?.capability !== request.capability.id) {
    throw new Error('Operation is not authorized for this target and capability.');
  }
  if (!contained(project.root, request.environment?.cwd || '')) throw new Error('Operation environment escapes the verified repository.');
  if (request.expectedPostcondition?.kind !== 'process-exit-code'
    || !Number.isInteger(request.expectedPostcondition.equals)) throw new Error('Operation postcondition is unsupported.');
  return Object.freeze(request);
}

export function operationContractRecord(request, record) {
  const executed = Number.isInteger(record.processExitCode);
  const expected = request.expectedPostcondition;
  const confirmed = executed ? record.processExitCode === expected.equals : UNKNOWN;
  const outcome = confirmed === true ? 'CONFIRMED' : confirmed === false ? 'CONTRADICTED' : UNKNOWN;
  return {
    schema: OPERATION_CONTRACT_SCHEMA,
    operationId: record.id,
    principal: request.principal,
    target: request.target,
    capability: request.capability,
    arguments: request.arguments,
    authorization: request.authorization,
    environment: request.environment,
    objective: request.objective,
    invocation: {
      attempted: true,
      submitted: true,
      acceptedByTarget: UNKNOWN,
      executed: executed || UNKNOWN,
      executionEvidence: executed ? 'observed-process-exit' : record.status === 'interrupted' ? 'process-absent-during-recovery' : UNKNOWN,
    },
    observations: {
      before: { type: 'git-snapshot', field: 'gitBefore' },
      after: { type: 'git-snapshot', field: 'gitAfter' },
    },
    expectedPostcondition: expected,
    verification: {
      outcome,
      observed: executed ? { processExitCode: record.processExitCode } : null,
      assurance: 'process-exit-only',
      externalEffectVerified: false,
    },
    evidence: {
      record: 'run.json', stdout: 'stdout.log', stderr: 'stderr.log',
      integrity: 'sha256-checksum-not-authenticated',
    },
    recovery: {
      state: record.status === 'interrupted' ? 'OUTCOME_UNKNOWN' : 'FINALIZED',
      blindRetryPermitted: false,
    },
    reuse: { eligible: false, reason: 'Arbitrary argv execution is not a retained reusable capability.' },
    limitations: ['Process exit confirms only the declared process postcondition, not an external application effect.'],
  };
}
