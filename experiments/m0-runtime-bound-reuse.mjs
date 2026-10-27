// Bounded prototype: runtime-bound reuse for exactly 'git rev-parse --verify HEAD'.
// Uses real CommandHUD core and pinned historical evidence-reuse helper in CI.
// Not a general dependency resolver or production acceptance test.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveProject } from '../packages/commandhud/core.mjs';
import { executeReusableVerification } from '../packages/commandhud/evidence-reuse.mjs';

const command = ['git', 'rev-parse', '--verify', 'HEAD'];
let trustedProbeCalls = 0;
function gitRead(root, ...args) {
  trustedProbeCalls++;
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', timeout: 5000, windowsHide: true }).trim();
}
function trustedDefinition(project, requested) {
  if (requested.identity !== 'repository/head' || JSON.stringify(requested.argv) !== JSON.stringify(command)) {
    throw new Error('UNSUPPORTED_RUNTIME_BOUND_COMMAND');
  }
  // Never accept the caller's potentially stale dependencies as current authority.
  // Both probes must succeed or no retained evidence can be returned.
  const head = gitRead(project.root, 'rev-parse', '--verify', 'HEAD');
  const dirty = gitRead(project.root, 'status', '--porcelain=v1', '--untracked-files=all').length > 0;
  return { ...requested, dependencies: { head, dirty } };
}
async function executeTrusted(project, requested) {
  return executeReusableVerification(project, trustedDefinition(project, requested));
}
const root = mkdtempSync(join(tmpdir(), 'indro-m0-runtime-bound-'));
const repo = join(root, 'repo');
function git(...args) {
  return execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
}
try {
  mkdirSync(repo);
  git('init', '-q');
  git('config', 'user.name', 'INDRO Bounded Experiment');
  git('config', 'user.email', 'bounded@example.invalid');
  const tracked = join(repo, 'tracked.txt');
  writeFileSync(tracked, 'v1\n');
  git('add', 'tracked.txt');
  git('commit', '-qm', 'initial');
  const originalHead = git('rev-parse', 'HEAD');
  const project = await resolveProject({ root: repo, env: { ...process.env, HUD_STATE_ROOT: join(root, 'state') } });
  const requested = {
    identity: 'repository/head', argv: command, inputs: { profile: 'diagnostic' },
    dependencies: { head: originalHead, dirty: false },
    environment: { platform: process.platform, node: process.version },
  };
  const cold = await executeTrusted(project, requested);
  assert.equal(cold.executed, true);
  assert.equal(cold.validation.valid, true);
  const warm = await executeTrusted(project, requested);
  assert.equal(warm.executed, false);
  assert.equal(warm.record.id, cold.record.id);

  writeFileSync(tracked, 'v2\n');
  const dirty = await executeTrusted(project, requested);
  assert.equal(dirty.executed, true, 'Dirty transition must invalidate clean evidence');
  assert.equal(dirty.validation.valid, true);
  assert.notEqual(dirty.record.id, cold.record.id);

  git('add', 'tracked.txt');
  git('commit', '-qm', 'changed runtime HEAD');
  const changedHead = git('rev-parse', 'HEAD');
  assert.notEqual(changedHead, originalHead);
  const changed = await executeTrusted(project, requested); // intentionally stale caller descriptor
  assert.equal(changed.executed, true, 'HEAD transition must invalidate old evidence');
  assert.equal(changed.validation.valid, true);
  assert.equal(readFileSync(changed.record.stdoutPath, 'utf8').trim(), changedHead);
  const changedWarm = await executeTrusted(project, requested);
  assert.equal(changedWarm.executed, false);
  assert.equal(changedWarm.record.id, changed.record.id);

  appendFileSync(changed.record.stdoutPath, 'tampered');
  const tampered = await executeTrusted(project, requested);
  assert.equal(tampered.executed, true);
  assert.ok(tampered.rejected?.reasons.includes('TAMPERED_EVIDENCE'));
  assert.equal(readFileSync(tampered.record.stdoutPath, 'utf8').trim(), changedHead);

  assert.throws(() => trustedDefinition(project, { ...requested, argv: ['git', 'status'] }), /UNSUPPORTED_RUNTIME_BOUND_COMMAND/);
  assert.throws(() => trustedDefinition({ ...project, root: join(root, 'not-a-git-repo') }, requested));
  console.log(JSON.stringify({
    schema: 'indro.m0.runtime-bound-reuse/v1',
    authority: 'real CommandHUD core, pinned feature helper, fresh Git probes',
    originalHead, changedHead,
    controls: {
      coldExecuted: cold.executed,
      warmReused: !warm.executed,
      dirtyTransitionExecuted: dirty.executed,
      staleCallerHeadExecuted: changed.executed,
      changedHeadWarmReused: !changedWarm.executed,
      tamperedEvidenceReexecuted: tampered.executed,
      unsupportedCommandRejected: true,
      invalidGitRootRejected: true,
    },
    trustedProbeCalls,
    verdict: 'BOUNDED_GIT_HEAD_REUSE_GUARD_PASS',
    limitations: [
      'Only git rev-parse --verify HEAD; not arbitrary application verification',
      'No atomicity across Git snapshot and command; concurrent mutation remains a race',
      'Dirty flag does not capture changes within an already-dirty worktree',
      'Disposable Git repository, no real-game performance or workstation proof',
    ],
  }, null, 2));
} finally {
  rmSync(root, { recursive: true, force: true });
}
