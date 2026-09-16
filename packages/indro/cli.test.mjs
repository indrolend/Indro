import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import test from 'node:test';

const here = path.dirname(fileURLToPath(import.meta.url));
const cli = path.join(here, 'cli.mjs');

test('Indro help exposes language and CommandHUD authority', () => {
  const result = spawnSync(process.execPath, [cli, 'help'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /indro compile/);
  assert.match(result.stdout, /CommandHUD compatibility/);
});

test('Indro compiles compact source through the canonical CLI', () => {
  const result = spawnSync(process.execPath, [cli, 'compile', path.join(here, 'examples', 'repair.i'),
    '--set', 'target=Indro.psm1', '--allow-effect', 'write', '--check'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /INDRO_CHECK PASS/);
});

test('Indro proof planner produces a cold verified plan', () => {
  const result = spawnSync(process.execPath, [cli, 'proof-plan', 'verified', '--state',
    path.join(here, 'examples', 'proof-state.json')], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const plan = JSON.parse(result.stdout);
  assert.deepEqual(plan.run, ['parse', 'lint', 'build', 'test', 'smoke', 'verified']);
});
