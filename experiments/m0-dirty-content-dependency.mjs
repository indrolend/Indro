// Diagnostic only: does dirty=true hide further content/index changes?
// Uses canonical CommandHUD core and the pinned feature-only helper in CI.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveProject } from '../packages/commandhud/core.mjs';
import { executeReusableVerification } from '../packages/commandhud/evidence-reuse.mjs';

const command = ['git', 'diff', '--no-ext-diff', '--no-textconv', '--', 'tracked.txt'];
const root = mkdtempSync(join(tmpdir(), 'indro-m0-dirty-content-'));
const repo = join(root, 'repo');
let trustedProbes = 0;
function git(...args) { return execFileSync('git', args, { cwd: repo, encoding: 'utf8', timeout: 5000 }).trim(); }
function probe(cwd, ...args) { trustedProbes++; return execFileSync('git', args, { cwd, encoding: 'utf8', timeout: 5000 }).trim(); }
function definition(requested, project) {
  if (requested.identity !== 'repository/diff/tracked' || JSON.stringify(requested.argv) !== JSON.stringify(command)) {
    throw new Error('UNSUPPORTED_CONTENT_DEPENDENCY_COMMAND');
  }
  // Bounded snapshot, not an atomic transaction or general Git dependency graph.
  return {
    ...requested,
    dependencies: {
      head: probe(project.root, 'rev-parse', '--verify', 'HEAD'),
      indexBlob: probe(project.root, 'rev-parse', '--verify', ':tracked.txt'),
      worktreeBlob: probe(project.root, 'hash-object', '--', 'tracked.txt'),
    },
  };
}
async function guarded(project, requested) { return executeReusableVerification(project, definition(requested, project)); }
function output(result) { return readFileSync(result.record.stdoutPath, 'utf8'); }
try {
  mkdirSync(repo);
  git('init', '-q');
  git('config', 'user.name', 'INDRO Dirty Content Experiment');
  git('config', 'user.email', 'dirty-content@example.invalid');
  const tracked = join(repo, 'tracked.txt');
  writeFileSync(tracked, 'v1\n');
  git('add', 'tracked.txt');
  git('commit', '-qm', 'initial');
  const head = git('rev-parse', 'HEAD');
  const project = await resolveProject({ root: repo, env: { ...process.env, HUD_STATE_ROOT: join(root, 'state') } });
  const requested = {
    identity: 'repository/diff/tracked', argv: command, inputs: { scope: 'tracked.txt' },
    dependencies: { head, dirty: true },
    environment: { platform: process.platform, node: process.version },
  };
  writeFileSync(tracked, 'v2\n');
  assert.notEqual(git('status', '--porcelain=v1'), '');
  const baseline = await executeReusableVerification(project, requested);
  assert.equal(baseline.executed, true);
  assert.equal(baseline.validation.valid, true);
  const baselineOutput = output(baseline);
  const baselineWarm = await executeReusableVerification(project, requested);
  assert.equal(baselineWarm.executed, false);
  const hashCold = await guarded(project, requested);
  assert.equal(hashCold.executed, true);
  assert.equal(hashCold.validation.valid, true);
  assert.equal(output(hashCold), baselineOutput);
  const hashWarm = await guarded(project, requested);
  assert.equal(hashWarm.executed, false);

  writeFileSync(tracked, 'v3\n');
  assert.equal(git('rev-parse', 'HEAD'), head);
  assert.notEqual(git('status', '--porcelain=v1'), '');
  const stale = await executeReusableVerification(project, requested);
  assert.equal(stale.executed, false);
  assert.equal(output(stale), baselineOutput);
  const actualWorktreeOutput = execFileSync('git', command.slice(1), { cwd: repo, encoding: 'utf8' });
  assert.notEqual(actualWorktreeOutput, baselineOutput);
  const worktreeChanged = await guarded(project, requested);
  assert.equal(worktreeChanged.executed, true);
  assert.equal(worktreeChanged.validation.valid, true);
  assert.equal(output(worktreeChanged), actualWorktreeOutput);

  const beforeIndex = definition(requested, project).dependencies;
  writeFileSync(tracked, 'v4\n');
  git('add', 'tracked.txt');
  writeFileSync(tracked, 'v3\n');
  const afterIndex = definition(requested, project).dependencies;
  assert.equal(afterIndex.head, beforeIndex.head);
  assert.equal(afterIndex.worktreeBlob, beforeIndex.worktreeBlob);
  assert.notEqual(afterIndex.indexBlob, beforeIndex.indexBlob);
  assert.notEqual(git('status', '--porcelain=v1'), '');
  const actualIndexOutput = execFileSync('git', command.slice(1), { cwd: repo, encoding: 'utf8' });
  assert.notEqual(actualIndexOutput, actualWorktreeOutput);
  const indexChanged = await guarded(project, requested);
  assert.equal(indexChanged.executed, true);
  assert.equal(indexChanged.validation.valid, true);
  assert.equal(output(indexChanged), actualIndexOutput);
  const indexWarm = await guarded(project, requested);
  assert.equal(indexWarm.executed, false);

  assert.throws(() => definition({ ...requested, argv: ['git', 'status'] }, project), /UNSUPPORTED_CONTENT_DEPENDENCY_COMMAND/);
  assert.throws(() => definition(requested, { ...project, root: join(root, 'missing') }));
  rmSync(tracked);
  assert.throws(() => definition(requested, project));

  console.log(JSON.stringify({
    schema: 'indro.m0.dirty-content-dependency/v1',
    authority: 'real CommandHUD core + pinned feature-only helper + disposable Git repository',
    head,
    controls: {
      dirtyBaselineExecuted: baseline.executed,
      dirtyBaselineWarmReused: !baselineWarm.executed,
      sameDirtyWorktreeChangeStaleReused: !stale.executed && output(stale) === baselineOutput,
      hashedColdExecuted: hashCold.executed,
      hashedWarmReused: !hashWarm.executed,
      changedWorktreeHashReexecuted: worktreeChanged.executed,
      indexChangedWithIdenticalWorktreeHash: afterIndex.worktreeBlob === beforeIndex.worktreeBlob,
      changedIndexHashReexecuted: indexChanged.executed,
      unchangedIndexWarmReused: !indexWarm.executed,
      unsupportedCommandRejected: true,
      invalidGitRootRejected: true,
      missingTrackedFileRejected: true,
    },
    trustedProbes,
    verdict: 'DIRTY_BOOLEAN_INSUFFICIENT; BOUNDED_BLOB_BINDING_PASS',
    limitations: [
      'Diagnostic only; git diff on one tracked file, not general application verification',
      'Three Git probes per guarded call; no demonstrated speedup',
      'No atomicity between snapshot and execution; attributes/config/filter dependencies not covered',
      'No user workstation or data-game access',
    ],
  }, null, 2));
} finally {
  rmSync(root, { recursive: true, force: true });
}
