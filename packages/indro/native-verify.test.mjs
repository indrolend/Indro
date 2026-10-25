import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { snapshotNative, verifyNative } from './native-verify.mjs';

function fixture() {
  const parent = mkdtempSync(join(tmpdir(), 'indro-native-proof-'));
  const root = join(parent, 'source'), build = join(root, 'build'), store = join(parent, 'evidence');
  mkdirSync(root);
  writeFileSync(join(root, '.gitignore'), 'build/\n');
  writeFileSync(join(root, 'CMakeLists.txt'), 'cmake_minimum_required(VERSION 3.16)\nproject(proof CXX)\nenable_testing()\nadd_executable(probe probe.cpp)\nadd_test(NAME probe COMMAND probe)\n');
  writeFileSync(join(root, 'probe.cpp'), '#include <iostream>\nint main(){std::cout << "PASS"; return 0;}\n');
  execFileSync('git', ['init', '-q', root]);
  execFileSync('git', ['-C', root, 'add', '.']);
  execFileSync('git', ['-C', root, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'fixture']);
  execFileSync('cmake', ['-S', root, '-B', build], { stdio: 'pipe' });
  return { parent, root, build, store, runtimeClosureDeclared: true };
}

test('real CTest execution and unchanged reuse', () => {
  const f = fixture();
  try {
    const first = verifyNative(f), second = verifyNative(f);
    assert.equal(first.outcome, 'EXECUTED'); assert.equal(first.testCount, 1); assert.equal(first.reusable, true);
    const recorded = JSON.parse(readFileSync(join(f.store, first.receipt), 'utf8')).snapshot;
    const current = snapshotNative(f);
    const changed = Object.keys(current.inputs).filter(key => JSON.stringify(recorded.inputs[key]) !== JSON.stringify(current.inputs[key]));
    assert.equal(second.outcome, 'REUSED', JSON.stringify({ changed, recorded: recorded.fingerprint, current: current.fingerprint })); assert.equal(second.testCount, 1);
    assert.ok(second.elapsedMs >= second.buildMs);
  } finally { rmSync(f.parent, { recursive: true, force: true }); }
});

test('source changes invalidate proof even if output binary is identical', () => {
  const f = fixture();
  try {
    assert.equal(verifyNative(f).outcome, 'EXECUTED');
    appendFileSync(join(f.root, 'probe.cpp'), '\n// source changed\n');
    assert.equal(verifyNative(f).outcome, 'EXECUTED');
  } finally { rmSync(f.parent, { recursive: true, force: true }); }
});

test('changed binary invalidates proof', () => {
  const f = fixture();
  try {
    assert.equal(verifyNative(f).outcome, 'EXECUTED');
    appendFileSync(snapshotNative(f).inputs.executables[0][0], '\n');
    assert.equal(verifyNative(f).outcome, 'EXECUTED');
  } finally { rmSync(f.parent, { recursive: true, force: true }); }
});

test('changed configuration invalidates proof', () => {
  const f = fixture();
  try {
    assert.equal(verifyNative(f).outcome, 'EXECUTED');
    const cache = join(f.build, 'CMakeCache.txt');
    writeFileSync(cache, readFileSync(cache, 'utf8').replace(/^CMAKE_INSTALL_PREFIX:PATH=.*$/m, 'CMAKE_INSTALL_PREFIX:PATH=/indro-proof-changed'));
    assert.equal(verifyNative(f).outcome, 'EXECUTED');
  } finally { rmSync(f.parent, { recursive: true, force: true }); }
});

test('corrupt newest receipt cannot reuse older success', () => {
  const f = fixture();
  try {
    assert.equal(verifyNative(f).outcome, 'EXECUTED');
    const file = join(f.store, readdirSync(f.store)[0]);
    const data = JSON.parse(readFileSync(file, 'utf8')); data.status = 'FAIL';
    writeFileSync(file, JSON.stringify(data));
    assert.equal(verifyNative(f).outcome, 'EXECUTED');
  } finally { rmSync(f.parent, { recursive: true, force: true }); }
});

test('undeclared runtime closure forces execution', () => {
  const f = fixture();
  try {
    const unsafe = { ...f, runtimeClosureDeclared: false };
    assert.equal(verifyNative(unsafe).reusable, false);
    assert.equal(verifyNative(unsafe).outcome, 'EXECUTED');
  } finally { rmSync(f.parent, { recursive: true, force: true }); }
});

test('CMake source mismatch rejects snapshot', () => {
  const f = fixture();
  try {
    const cache = join(f.build, 'CMakeCache.txt');
    writeFileSync(cache, readFileSync(cache, 'utf8').replace(/^CMAKE_HOME_DIRECTORY:INTERNAL=.*$/m, `CMAKE_HOME_DIRECTORY:INTERNAL=${f.parent}`));
    assert.throws(() => snapshotNative(f), /CMake cache belongs/);
  } finally { rmSync(f.parent, { recursive: true, force: true }); }
});

test('failed CTest never produces reusable evidence', () => {
  const f = fixture();
  try {
    assert.equal(verifyNative(f).outcome, 'EXECUTED');
    writeFileSync(join(f.root, 'probe.cpp'), 'int main(){return 1;}\n');
    assert.equal(verifyNative(f).outcome, 'FAILED');
    assert.equal(verifyNative(f).outcome, 'FAILED');
  } finally { rmSync(f.parent, { recursive: true, force: true }); }
});

test('declared external runtime file invalidates proof when changed', () => {
  const f = fixture();
  try {
    const dependency = join(f.parent, 'runtime.dat');
    writeFileSync(dependency, 'version-1');
    const options = { ...f, runtimeFiles: [dependency] };
    assert.equal(verifyNative(options).outcome, 'EXECUTED');
    assert.equal(verifyNative(options).outcome, 'REUSED');
    writeFileSync(dependency, 'version-2');
    assert.equal(verifyNative(options).outcome, 'EXECUTED');
  } finally { rmSync(f.parent, { recursive: true, force: true }); }
});

for (const property of ['DISABLED TRUE', 'SKIP_RETURN_CODE 0', 'SKIP_REGULAR_EXPRESSION PASS']) {
  test(`CTest ${property} cannot produce reusable proof despite exit code zero`, () => {
    const f = fixture();
    try {
      appendFileSync(join(f.root, 'CMakeLists.txt'), `set_tests_properties(probe PROPERTIES ${property})\n`);
      const first = verifyNative(f), second = verifyNative(f);
      assert.equal(first.outcome, 'EXECUTED');
      assert.equal(first.reusable, false);
      assert.equal(second.outcome, 'EXECUTED');
      assert.deepEqual(snapshotNative(f).potentiallySkippedTests, ['probe']);
    } finally { rmSync(f.parent, { recursive: true, force: true }); }
  });
}

test('CMake compiler metadata establishes provenance without compiler cache entry', () => {
  const f = fixture();
  try {
    assert.equal(verifyNative(f).outcome, 'EXECUTED');
    const cachePath = join(f.build, 'CMakeCache.txt');
    const cache = readFileSync(cachePath, 'utf8');
    writeFileSync(cachePath, cache.split(String.fromCharCode(10)).filter(line => !line.startsWith('CMAKE_CXX_COMPILER:')).join(String.fromCharCode(10)));
    const snapshot = snapshotNative(f);
    assert.equal(snapshot.complete, true);
    assert.ok(snapshot.inputs.compilers?.CMAKE_CXX_COMPILER?.sha256);
    assert.ok(snapshot.inputs.compilers.CMAKE_CXX_COMPILER.metadata.length > 0);
  } finally { rmSync(f.parent, { recursive: true, force: true }); }
});
