import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('./benchmark-native.mjs', import.meta.url));
const exec = (cmd, args, cwd) => {
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8', windowsHide: true });
  assert.equal(r.status, 0, cmd + ': ' + (r.stderr || r.stdout || r.error?.message));
  return r.stdout;
};

test('benchmark refuses an undeclared runtime closure without writing evidence', () => {
  const dir = mkdtempSync(join(tmpdir(), 'indro-benchmark-guard-'));
  try {
    const store = join(dir, 'store'), output = join(dir, 'results.json');
    const r = spawnSync(process.execPath, [script, '--root', dir, '--build', dir, '--store', store, '--output', output], { encoding: 'utf8' });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /runtime.closure|declare-runtime-closure/i);
    assert.equal(existsSync(store), false);
    assert.equal(existsSync(output), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('benchmark measures real CTest and reports reuse or safe invalidation', () => {
  const dir = mkdtempSync(join(tmpdir(), 'indro-benchmark-ctest-'));
  try {
    const root = join(dir, 'source'), build = join(root, 'build');
    mkdirSync(root);
    writeFileSync(join(root, '.gitignore'), 'build/\n');
    writeFileSync(join(root, 'CMakeLists.txt'), 'cmake_minimum_required(VERSION 3.16)\nproject(probe CXX)\nenable_testing()\nadd_executable(probe probe.cpp)\nadd_test(NAME probe COMMAND probe)\n');
    writeFileSync(join(root, 'probe.cpp'), 'int main() { return 0; }\n');
    exec('git', ['init', '-q'], root);
    exec('git', ['add', '.gitignore', 'CMakeLists.txt', 'probe.cpp'], root);
    exec('git', ['-c', 'user.name=Probe', '-c', 'user.email=probe@example.invalid', 'commit', '-qm', 'Fixture'], root);
    exec('cmake', ['-S', root, '-B', build], root);
    const store = join(dir, 'evidence'), output = join(dir, 'results.json');
    const r = spawnSync(process.execPath, [script, '--root', root, '--build', build, '--store', store, '--output', output,
      '--runs', '2', '--declare-runtime-closure'], { cwd: root, encoding: 'utf8', windowsHide: true, timeout: 120000 });
    assert.equal(r.status, 0, r.stderr || r.stdout || r.error?.message);
    const report = JSON.parse(readFileSync(output, 'utf8'));
    assert.equal(report.error, null);
    assert.equal(report.repetitions, 2);
    const attempts = report.records.filter(record => record.kind === 'indro-reuse');
    assert.ok(attempts.length >= 1);
    assert.ok(report.records.filter(record => record.kind === 'ctest').every(record => record.testCount === 1));
    assert.equal(report.records.filter(record => record.kind === 'indro-first' && record.outcome === 'EXECUTED').length, 1);
    if (report.reuseStatus === 'REUSED') {
      assert.equal(attempts.length, 2);
      assert.ok(attempts.every(record => record.outcome === 'REUSED'));
      assert.ok(report.speedup > 0);
    } else {
      assert.equal(report.reuseStatus, 'INVALIDATED');
      assert.equal(attempts.at(-1).outcome, 'EXECUTED');
      assert.equal(report.speedup, null);
      assert.ok(report.invalidation?.changedInputs?.length);
    }
    assert.ok(report.ordinaryMedianMs > 0 && report.reuseMedianMs > 0);
    assert.equal(exec('git', ['status', '--porcelain'], root).trim(), '');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
