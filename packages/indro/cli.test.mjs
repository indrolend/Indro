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

test('canonical Indro routes native verification and rejects incomplete requests', () => {
  const help = spawnSync(process.execPath, [cli, 'help'], { encoding: 'utf8' });
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /indro verify-native/);
  const rejected = spawnSync(process.execPath, [cli, 'verify-native'], { encoding: 'utf8' });
  assert.equal(rejected.status, 2);
  assert.match(rejected.stderr, /INDRO_NATIVE_VERIFY_ERROR.*Usage:/);
});

test('canonical INDRO routes retained capabilities and rejects unverified operations', () => {
  const invoke = (...args) => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
  const help = invoke('help');
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /indro capability list/);
  assert.match(help.stdout, /indro paint verify/);
  assert.match(help.stdout, /indro fl plugin set/);
  const fl = invoke('fl', 'help');
  assert.equal(fl.status, 0, fl.stderr);
  assert.match(fl.stdout, /indro fl plugin set/);
  const list = invoke('capability', 'list', '--json');
  assert.equal(list.status, 0, list.stderr);
  assert.ok(Array.isArray(JSON.parse(list.stdout).capabilities));
  const paint = invoke('paint', 'verify', '--json');
  assert.equal(paint.status, 1);
  assert.ok(JSON.parse(paint.stdout).error);
  const denied = invoke('capability', 'invoke', 'missing', '--value', '0.5', '--authorize-write', '--json');
  assert.equal(denied.status, 1);
  assert.equal(JSON.parse(denied.stdout).error, 'CAPABILITY_WRITE_REQUIRES_VERIFY');
});

test('canonical INDRO routes Godot replay and rejects unsupported scenarios and unintegrated commands', () => {
  const invoke = (...args) => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
  assert.match(invoke('help').stdout, /indro godot replay/);
  const rejected = invoke('godot', 'replay', '--scenario', 'unknown');
  assert.equal(rejected.status, 1);
  assert.match(rejected.stderr, /Unknown Godot replay scenario/);
  const unsupported = invoke('godot', 'benchmark');
  assert.equal(unsupported.status, 2);
  assert.match(unsupported.stderr, /supports replay only/);
});

test('canonical INDRO runs bounded NDRA static self-test and rejects unscoped requests', () => {
  const invoke = (...args) => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
  assert.match(invoke('help').stdout, /indro ndra repo --self-test/);
  const positive = invoke('ndra', 'repo', '--self-test');
  assert.equal(positive.status, 0, positive.stderr);
  assert.match(positive.stdout, /PASS: exact proof, real-shape counterexample, unsupported UNKNOWN/);
  for (const args of [['ndra'], ['ndra', 'unsupported'], ['ndra', 'repo'], ['ndra', 'repo', '--workspace', 'missing']]) {
    const negative = invoke(...args);
    assert.equal(negative.status, 2, JSON.stringify({ args, stdout: negative.stdout, stderr: negative.stderr }));
    assert.match(negative.stderr, /INDRO_ERROR ndra repo requires/);
  }
});
