// Diagnostic experiment, not a production acceptance test.
// Requires the pinned feature-only evidence-reuse.mjs beside canonical core.mjs.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gitSnapshot, resolveProject } from '../packages/commandhud/core.mjs';
import { executeReusableVerification } from '../packages/commandhud/evidence-reuse.mjs';

const root = mkdtempSync(join(tmpdir(), 'indro-real-core-reuse-'));
const repo = join(root, 'repo');
function git(...args) {
  return execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
}
try {
  mkdirSync(repo);
  git('init', '-q');
  git('config', 'user.name', 'INDRO Falsifier');
  git('config', 'user.email', 'falsifier@example.invalid');
  const tracked = join(repo, 'tracked.txt');
  writeFileSync(tracked, 'version 1\n');
  git('add', 'tracked.txt');
  git('commit', '-qm', 'initial');
  const originalHead = git('rev-parse', 'HEAD');
  const project = await resolveProject({ root: repo, env: { ...process.env, HUD_STATE_ROOT: join(root, 'state') } });
  const definition = {
    identity: 'repository/head',
    argv: ['git', 'rev-parse', '--verify', 'HEAD'],
    inputs: { profile: 'diagnostic' },
    dependencies: { head: originalHead, dirty: false },
    environment: { platform: process.platform, node: process.version },
  };
  const cold = await executeReusableVerification(project, definition);
  assert.equal(cold.executed, true);
  assert.equal(cold.validation.valid, true);
  const warm = await executeReusableVerification(project, definition);
  assert.equal(warm.executed, false);
  assert.equal(warm.validation.valid, true);
  assert.equal(warm.record.id, cold.record.id);

  writeFileSync(tracked, 'version 2\n');
  assert.equal((await gitSnapshot(repo)).dirty, true);
  const dirty = await executeReusableVerification(project, definition);
  const dirtyReused = !dirty.executed && dirty.validation.valid && dirty.record.id === cold.record.id;

  git('add', 'tracked.txt');
  git('commit', '-qm', 'actual runtime dependency changed');
  const changedHead = git('rev-parse', 'HEAD');
  assert.notEqual(changedHead, originalHead);
  const stale = await executeReusableVerification(project, definition);
  const staleOutput = readFileSync(stale.record.stdoutPath, 'utf8').trim();
  const staleReused = !stale.executed && stale.validation.valid && staleOutput === originalHead;

  const refreshed = structuredClone(definition);
  refreshed.dependencies = { head: changedHead, dirty: false };
  const fresh = await executeReusableVerification(project, refreshed);
  assert.equal(fresh.executed, true);
  assert.equal(fresh.validation.valid, true);
  assert.equal(readFileSync(fresh.record.stdoutPath, 'utf8').trim(), changedHead);

  appendFileSync(fresh.record.stdoutPath, 'tampered');
  const tampered = await executeReusableVerification(project, refreshed);
  assert.equal(tampered.executed, true);
  assert.ok(tampered.rejected.reasons.includes('TAMPERED_EVIDENCE'));

  console.log(JSON.stringify({
    schema: 'indro.m0.real-core-reuse-falsifier/v1',
    authority: 'canonical CommandHUD core + pinned feature-only reuse helper',
    originalHead, changedHead,
    controls: {
      coldExecuted: cold.executed,
      warmReused: !warm.executed,
      dirtyRuntimeReusedOldEvidence: dirtyReused,
      changedHeadReusedOldEvidence: staleReused,
      refreshedDescriptorExecuted: fresh.executed,
      tamperedEvidenceReexecuted: tampered.executed,
    },
    result: dirtyReused && staleReused ? 'STALE_REUSE_REPRODUCED' : 'STALE_REUSE_NOT_REPRODUCED',
    limitation: 'Disposable Git repository; no real-game or user-workstation execution.',
  }, null, 2));
  assert.equal(dirtyReused, true, 'Unexpected dirty-worktree invalidation; investigate new behavior.');
  assert.equal(staleReused, true, 'Unexpected HEAD invalidation; investigate new behavior.');
} finally {
  rmSync(root, { recursive: true, force: true });
}
