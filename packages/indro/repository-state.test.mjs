import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { verifyRepositoryState, recognizesRepositoryStateObjective } from './repository-state.mjs';

function git(root, ...args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, result.stderr);
}

test('repository objective acquires live state, reuses it, and invalidates a worktree change', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'indro-repository-'));
  process.env.HUD_STATE_ROOT = mkdtempSync(path.join(tmpdir(), 'indro-repository-state-'));
  git(root, 'init');
  git(root, 'config', 'user.email', 'indro-test@example.invalid');
  git(root, 'config', 'user.name', 'INDRO Test');
  writeFileSync(path.join(root, 'tracked.txt'), 'one\n');
  git(root, 'add', 'tracked.txt');
  git(root, 'commit', '-m', 'fixture');

  const cold = await verifyRepositoryState(root);
  const warm = await verifyRepositoryState(root);
  writeFileSync(path.join(root, 'tracked.txt'), 'two\n');
  const changed = await verifyRepositoryState(root);

  assert.equal(cold.executed, true);
  assert.equal(warm.skipped, true);
  assert.equal(warm.evidenceId, cold.evidenceId);
  assert.equal(changed.executed, true);
  assert.equal(changed.reuseDecision, 'invalidated');
  assert.equal(changed.dirty, true);
  assert.notEqual(changed.evidenceId, cold.evidenceId);
  assert.equal(recognizesRepositoryStateObjective('Verify current repository state'), true);
});
