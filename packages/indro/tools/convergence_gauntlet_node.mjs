import { pathToFileURL } from 'node:url';
import { appendFileSync } from 'node:fs';

const [uaiPath, ndraPath, repositoryRoot, stateRoot] = process.argv.slice(2);
if (!uaiPath || !ndraPath || !repositoryRoot || !stateRoot) throw new Error('UAI, NDRA, repository, and CommandHUD state paths are required');

const { assay } = await import(pathToFileURL(uaiPath));
const { proveBounded } = await import(pathToFileURL(ndraPath));
const commandHudRoot = new URL('../../commandhud/', import.meta.url);
const { gitSnapshot, resolveProject } = await import(new URL('core.mjs', commandHudRoot));
const { executeReusableVerification, validateReusableCommandEvidence } = await import(new URL('evidence-reuse.mjs', commandHudRoot));

const states = [{ charge: 0 }, { charge: 2 }];
const inputs = [0, 1, 3];
const baseline = (state, input) => ({ charge: state.charge + input, implementation: 'left' });
const equivalent = (state, input) => ({ charge: input + state.charge, implementation: 'right' });
const mutant = (state, input) => ({ charge: state.charge + input * 2, implementation: 'mutant' });

const uai = {
  equivalent: assay({
    initialStates: states, inputs, left: baseline, right: equivalent,
    project: value => value.charge, projectionId: 'charge-v1', comparatorId: 'deep-v1'
  }),
  mutant: assay({
    initialStates: states, inputs, left: baseline, right: mutant,
    project: value => value.charge, projectionId: 'charge-v1', comparatorId: 'deep-v1'
  }),
  bounded: assay({ initialStates: states, inputs, left: baseline, right: equivalent, maxCases: 2 })
};

const ndra = {
  equivalent: proveBounded({
    variables: { x: [-100, 100] }, left: ['+', 'x', 'x'], right: ['*', 2, 'x']
  }),
  mutant: proveBounded({
    variables: { x: [-100, 100] }, left: ['+', 'x', 'x'], right: ['+', ['*', 2, 'x'], 1]
  })
};

const project = await resolveProject({ root: repositoryRoot, env: { ...process.env, HUD_STATE_ROOT: stateRoot } });
const head = (await gitSnapshot(project.root)).head;
const base = {
  identity: 'convergence/repository-head',
  argv: ['git', 'rev-parse', '--verify', 'HEAD'],
  inputs: { verification: 'head-exists', profile: 'default' },
  dependencies: { repository: project.identity.id, head },
  environment: { platform: process.platform, arch: process.arch, node: process.version },
};
const cold = await executeReusableVerification(project, base, { objective: 'Verify the convergence repository HEAD' });
const warm = await executeReusableVerification(project, base, { objective: 'Reuse verified convergence repository HEAD evidence' });
const changedDefinition = structuredClone(base);
changedDefinition.inputs.profile = 'strict';
const changedInput = await executeReusableVerification(project, changedDefinition);

const failedDefinition = structuredClone(base);
failedDefinition.identity = 'convergence/missing-ref';
failedDefinition.argv = ['git', 'rev-parse', '--verify', 'refs/heads/__commandhud_missing_ref__'];
const failed = await executeReusableVerification(project, failedDefinition, { requiredOutput: 'none' });
const staleDefinition = structuredClone(base);
staleDefinition.dependencies.head = '0'.repeat(40);
const stale = validateReusableCommandEvidence(project, cold.record, staleDefinition);
const mismatchedRecord = structuredClone(cold.record);
mismatchedRecord.operation.reusableEvidence.descriptor.inputs.verification = 'different-command-contract';
const mismatched = validateReusableCommandEvidence(project, mismatchedRecord, base);
const missingRecord = structuredClone(cold.record);
missingRecord.stdoutPath = `${cold.record.stdoutPath}.missing`;
const missing = validateReusableCommandEvidence(project, missingRecord, base);
appendFileSync(cold.record.stdoutPath, 'CORRUPTED_FOR_GAUNTLET');
const corrupted = validateReusableCommandEvidence(project, cold.record, base);
const repaired = await executeReusableVerification(project, base);

const attempts = [cold, warm, changedInput, failed, repaired];
const evidenceReuse = {
  authority: 'packages/commandhud/evidence-reuse.mjs',
  command: { identity: base.identity, argv: base.argv },
  retained: {
    inputs: base.inputs, dependencies: base.dependencies, environment: base.environment,
    exitCode: repaired.record.exitCode, outputHashes: repaired.record.evidence,
    runId: repaired.record.id, evidenceIdentity: repaired.validation.evidenceIdentity,
    stdoutPath: repaired.record.stdoutPath, stderrPath: repaired.record.stderrPath,
  },
  scenarios: {
    cold: { executed: cold.executed, runId: cold.record.id, valid: cold.validation.valid, timing: cold.timing },
    warm: { skipped: warm.skipped, runId: warm.record.id, valid: warm.validation.valid, timing: warm.timing },
    changedInput: { executed: changedInput.executed, runId: changedInput.record.id, rejected: changedInput.rejected?.reasons || [] },
    failed: { executed: failed.executed, status: failed.record.status, valid: failed.validation.valid, reasons: failed.validation.reasons },
    missing: { valid: missing.valid, reasons: missing.reasons },
    stale: { valid: stale.valid, reasons: stale.reasons },
    mismatched: { valid: mismatched.valid, reasons: mismatched.reasons },
    corrupted: { valid: corrupted.valid, reasons: corrupted.reasons },
    repaired: { executed: repaired.executed, runId: repaired.record.id, rejected: repaired.rejected?.reasons || [], valid: repaired.validation.valid },
  },
  measurements: {
    commandsExecuted: attempts.filter(item => item.executed).length,
    commandsSkipped: attempts.filter(item => item.skipped).length,
    totalNs: attempts.reduce((sum, item) => sum + item.timing.totalNs, 0),
    coldExecutionNs: cold.timing.executionNs,
    warmValidationNs: warm.timing.validationNs,
    measuredAvoidedExecutionNs: Math.max(0, cold.timing.executionNs - warm.timing.totalNs),
  },
};

process.stdout.write(JSON.stringify({ uai, ndra, evidenceReuse }));
