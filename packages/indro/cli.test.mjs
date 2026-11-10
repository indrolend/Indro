import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import test from 'node:test';

const here = path.dirname(fileURLToPath(import.meta.url));
const cli = path.join(here, 'cli.mjs');

test('Indro help exposes language and CommandHUD authority', () => {
  const result = spawnSync(process.execPath, [cli, 'help'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /indro compile/);
  assert.match(result.stdout, /CommandHUD compatibility/);
  assert.match(result.stdout, /indro godot replay/);
  assert.match(result.stdout, /indro run --objective/);
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

test('Indro proof planner accepts a bounded domain claim graph', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'indro-proof-'));
  const graph = path.join(root, 'graph.json');
  const state = path.join(root, 'state.json');
  writeFileSync(graph, JSON.stringify({ behavior: { inputs: ['observations'] }, frame: { inputs: ['capture'] }, playthrough: { deps: ['behavior', 'frame'] } }));
  writeFileSync(state, JSON.stringify({ observations: 'sha256:o', capture: 'sha256:p' }));
  const result = spawnSync(process.execPath, [cli, 'proof-plan', 'playthrough', '--state', state, '--graph', graph], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout).run, ['behavior', 'frame', 'playthrough']);
});

test('canonical Indro routes work and UAI fixture commands and rejects unsupported operations', () => {
  for (const [args, expected] of [
    [['work', 'help'], /indro work inspect/],
    [['app', 'help'], /indro app fixture set/]
  ]) {
    const result = spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, expected);
  }
  const mutation = spawnSync(process.execPath, [cli, 'app', 'fixture', 'set', '0.75', '--json'], { encoding: 'utf8' });
  assert.equal(mutation.status, 0, mutation.stderr);
  assert.equal(JSON.parse(mutation.stdout).verdict, 'STATE_CONFIRMED');
  const rejected = spawnSync(process.execPath, [cli, 'app', 'unsupported'], { encoding: 'utf8' });
  assert.equal(rejected.status, 2);
  assert.match(rejected.stderr, /INDRO_ERROR/);
});
