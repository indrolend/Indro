import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { executeOperation, gitSnapshot, recoverInterruptedRuns, repositoryCurrency, resolveProject, runById } from './core.mjs';
import { localArgvOperation, validateOperationRequest } from './operation-contract.mjs';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'indro-operation-contract-'));
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'fixture@example.invalid'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'Fixture'], { cwd: root });
  execFileSync('git', ['commit', '--allow-empty', '-qm', 'initial'], { cwd: root });
  return root;
}

test('one authorized argv operation persists lifecycle, observations, verification, and evidence', async () => {
  const root = fixture();
  const store = mkdtempSync(join(tmpdir(), 'indro-operation-store-'));
  const project = await resolveProject({ root, env: { ...process.env, HUD_STATE_ROOT: store } });
  const request = localArgvOperation(project, ['git', 'status', '--short'], { objective: 'Inspect real Git state.' });
  const record = await executeOperation(project, request, { stream: false, origin: 'cli-argv' });
  assert.equal(record.status, 'pass');
  assert.equal(record.contract.authorization.decision, 'ALLOW');
  assert.equal(record.contract.invocation.executed, true);
  assert.equal(record.contract.verification.outcome, 'CONFIRMED');
  assert.equal(record.contract.verification.externalEffectVerified, false);
  assert.equal(record.contract.recovery.blindRetryPermitted, false);
  const persisted = JSON.parse(readFileSync(join(store, 'runs', project.key, record.id, 'run.json'), 'utf8'));
  assert.deepEqual(persisted.contract, record.contract);
  assert.ok(persisted.gitBefore.head);
  assert.ok(persisted.gitAfter.head);
  assert.ok(persisted.evidence.stdout.sha256);
});

test('authorization and target mismatch reject before process execution', async () => {
  const root = fixture();
  const store = mkdtempSync(join(tmpdir(), 'indro-operation-store-'));
  const project = await resolveProject({ root, env: { ...process.env, HUD_STATE_ROOT: store } });
  const request = localArgvOperation(project, [process.execPath, '-e', 'process.exit(99)']);
  request.authorization.decision = 'DENY';
  assert.throws(() => validateOperationRequest(project, request), /not authorized/);
  assert.throws(() => validateOperationRequest(project, { ...localArgvOperation(project, ['git', 'status']), target: { type: 'git-repository', id: 'wrong', root } }), /target does not match/);
});

test('a contradicted declared postcondition cannot remain a passing operation', async () => {
  const root = fixture();
  const store = mkdtempSync(join(tmpdir(), 'indro-operation-store-'));
  const project = await resolveProject({ root, env: { ...process.env, HUD_STATE_ROOT: store } });
  const request = localArgvOperation(project, [process.execPath, '-e', 'process.exit(0)'], {
    expectedPostcondition: { kind: 'process-exit-code', equals: 7 },
  });
  const record = await executeOperation(project, request, { stream: false, origin: 'cli-argv' });
  assert.equal(record.status, 'fail');
  assert.equal(record.resultReason, 'POSTCONDITION_CONTRADICTED');
  assert.equal(record.contract.verification.outcome, 'CONTRADICTED');
});

test('startup recovery preserves the operation contract and uncertainty without retrying', async () => {
  const root = fixture();
  const store = mkdtempSync(join(tmpdir(), 'indro-operation-store-'));
  const project = await resolveProject({ root, env: { ...process.env, HUD_STATE_ROOT: store } });
  const request = localArgvOperation(project, [process.execPath, '-e', 'process.exit(0)']);
  const id = '20261029000000-cafe';
  const directory = join(store, 'runs', project.key, id);
  mkdirSync(directory, { recursive: true });
  const stdoutPath = join(directory, 'stdout.log');
  const stderrPath = join(directory, 'stderr.log');
  writeFileSync(stdoutPath, 'submitted before interruption\n');
  writeFileSync(stderrPath, '');
  writeFileSync(join(directory, 'inflight.json'), JSON.stringify({
    schemaVersion: 1, id, project: project.identity.id, root,
    request: request.objective, command: request.arguments.argv.join(' '), argv: request.arguments.argv,
    startedAt: '2026-10-29T00:00:00.000Z', pid: 2147483647,
    captureDelta: false, gitBefore: await gitSnapshot(root), currencyBefore: await repositoryCurrency(root), stdoutPath, stderrPath,
    operationContract: request,
  }));

  assert.deepEqual(await recoverInterruptedRuns(project), { recovered: [id], detached: [], corrupt: [] });
  const record = runById(project, id);
  assert.equal(record.status, 'interrupted');
  assert.equal(record.contract.invocation.executed, 'UNKNOWN');
  assert.equal(record.contract.verification.outcome, 'UNKNOWN');
  assert.equal(record.contract.recovery.state, 'OUTCOME_UNKNOWN');
  assert.equal(record.contract.recovery.blindRetryPermitted, false);
});
