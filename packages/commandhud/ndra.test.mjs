import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const cli = join(import.meta.dirname, 'cli.mjs');

test('NDRA help is discoverable without a repository', () => {
  const result = spawnSync(process.execPath, [cli, 'ndra', 'help'], { encoding: 'utf8' });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /hud ndra experiment residue-001/);
});
test('NDRA residue inspection reports suspicion and accepts spaces in paths', () => {
  const root = mkdtempSync(join(tmpdir(), 'ndra repo '));
  mkdirSync(join(root, 'game'));
  spawnSync('git', ['init', root]);
  spawnSync('git', ['-C', root, 'config', 'user.email', 'ndra@example.invalid']);
  spawnSync('git', ['-C', root, 'config', 'user.name', 'NDRA Test']);
  writeFileSync(join(root, 'game', 'Game.cpp'), 'void Game::updateParticles(float dt){ if(particle.pos.y>settledHeight){} else { if(residue&&state_.vacuum.active){} } }');
  spawnSync('git', ['-C', root, 'add', '.']);
  spawnSync('git', ['-C', root, 'commit', '-m', 'fixture']);
  const out = join(root, 'evidence output');
  const result = spawnSync(process.execPath, [cli, 'ndra', 'inspect', 'residue', '--repo', root, '--out', out], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(readFileSync(join(out, 'report.json'))).claim, 'source_suspicion');

  writeFileSync(join(root, 'game', 'Game.cpp'), 'void Game::updateParticles(float dt){ if(particle.pos.y>settledHeight){} else {} if(residue&&state_.vacuum.active){} }');
  const corrected = join(root, 'corrected evidence');
  const correctedResult = spawnSync(process.execPath, [cli, 'ndra', 'inspect', 'residue', '--repo', root, '--out', corrected], { encoding: 'utf8' });
  assert.equal(correctedResult.status, 0, correctedResult.stderr);
  assert.equal(JSON.parse(readFileSync(join(corrected, 'report.json'))).claim, 'blocked');
});

test('NDRA finite gauntlet is bounded and detects the mutant', () => {
  const root = mkdtempSync(join(tmpdir(), 'ndra-finite-'));
  spawnSync('git', ['init', root]);
  spawnSync('git', ['-C', root, 'config', 'user.email', 'ndra@example.invalid']);
  spawnSync('git', ['-C', root, 'config', 'user.name', 'NDRA Test']);
  writeFileSync(join(root, 'fixture.txt'), 'authority');
  spawnSync('git', ['-C', root, 'add', '.']);
  spawnSync('git', ['-C', root, 'commit', '-m', 'fixture']);
  const out = join(root, 'finite-evidence');
  const result = spawnSync(process.execPath, [cli, 'ndra', 'gauntlet', 'finite', '--repo', root, '--out', out], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(readFileSync(join(out, 'report.json')));
  assert.equal(report.minimal_states, 3);
  assert.equal(report.oracle_queries, 12);
  assert.equal(report.mutation_detected, true);
});
