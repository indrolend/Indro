import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { gitSnapshot, resolveProject } from './core.mjs';
import { executeReusableVerification, validateReusableCommandEvidence } from './evidence-reuse.mjs';

function repository() {
  const root = mkdtempSync(join(tmpdir(), 'commandhud-reuse-repo-'));
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'commandhud@example.invalid'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'CommandHUD Test'], { cwd: root });
  execFileSync('git', ['commit', '--allow-empty', '-qm', 'fixture'], { cwd: root });
  return root;
}

async function fixture(t) {
  const root = repository();
  const store = mkdtempSync(join(tmpdir(), 'commandhud-reuse-state-'));
  t.after(() => { rmSync(root, { recursive: true, force: true }); rmSync(store, { recursive: true, force: true }); });
  const project = await resolveProject({ root, env: { ...process.env, HUD_STATE_ROOT: store } });
  const head = (await gitSnapshot(root)).head;
  const definition = {
    identity: 'repository/head', argv: ['git', 'rev-parse', '--verify', 'HEAD'],
    inputs: { profile: 'default' }, dependencies: { head },
    environment: { platform: process.platform, arch: process.arch, node: process.version },
  };
  return { project, definition };
}

test('reusable verification executes cold and independently validates before warm reuse', async (t) => {
  const { project, definition } = await fixture(t);
  const cold = await executeReusableVerification(project, definition);
  const warm = await executeReusableVerification(project, definition);
  assert.equal(cold.executed, true);
  assert.equal(cold.record.status, 'pass');
  assert.equal(cold.validation.valid, true);
  assert.equal(warm.executed, false);
  assert.equal(warm.record.id, cold.record.id);
  assert.equal(warm.validation.integrity, 'VERIFIED');
  assert.match(warm.validation.evidenceIdentity, /^sha256:[0-9a-f]{64}$/);
  assert.ok(warm.timing.validationNs > 0);
});

test('reuse rejects changed inputs, failed records, missing bytes, tampering, staleness, and mismatch', async (t) => {
  const { project, definition } = await fixture(t);
  const cold = await executeReusableVerification(project, definition);
  assert.equal(cold.validation.valid, true);

  const changed = structuredClone(definition);
  changed.inputs.profile = 'strict';
  const changedValidation = validateReusableCommandEvidence(project, cold.record, changed);
  assert.ok(changedValidation.reasons.includes('MISMATCHED_EVIDENCE'));

  const stale = structuredClone(definition);
  stale.dependencies.head = '0'.repeat(40);
  assert.ok(validateReusableCommandEvidence(project, cold.record, stale).reasons.includes('MISMATCHED_EVIDENCE'));

  const failed = structuredClone(cold.record);
  failed.status = 'fail'; failed.operation.status = 'fail'; failed.exitCode = 1;
  assert.ok(validateReusableCommandEvidence(project, failed, definition).reasons.includes('FAILED_EVIDENCE'));

  const mismatched = structuredClone(cold.record);
  mismatched.operation.reusableEvidence.descriptor.identity = 'repository/other';
  assert.ok(validateReusableCommandEvidence(project, mismatched, definition).reasons.includes('MISMATCHED_DESCRIPTOR'));

  const missing = structuredClone(cold.record);
  missing.stdoutPath = join(project.store, 'absent.log');
  assert.ok(validateReusableCommandEvidence(project, missing, definition).reasons.includes('MISSING_RAW_EVIDENCE'));

  appendFileSync(cold.record.stdoutPath, 'tamper');
  const corrupt = validateReusableCommandEvidence(project, cold.record, definition);
  assert.equal(corrupt.integrity, 'CORRUPT');
  assert.ok(corrupt.reasons.includes('TAMPERED_EVIDENCE'));
  const rerun = await executeReusableVerification(project, definition);
  assert.equal(rerun.executed, true);
  assert.ok(rerun.rejected.reasons.includes('TAMPERED_EVIDENCE'));
  assert.notEqual(rerun.record.id, cold.record.id);
});
