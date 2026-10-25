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
    assert.equal(first.outcome, 'EXECUTED'); assert.equal(first.testCount, 1); assert.equal(first.reusable, true, JSON.stringify({ compilers: snapshotNative(f).inputs.compilers, executables: snapshotNative(f).inputs.executables, cacheCompiler: readFileSync(join(f.build, 'CMakeCache.txt'), 'utf8').split('\\n').filter(line => /^CMAKE_(C|CXX)_COMPILER/.test(line)), compilerMetadata: readdirSync(join(f.build, 'CMakeFiles')).flatMap(name => { try { return readFileSync(join(f.build, 'CMakeFiles', name, 'CMakeCXXCompiler.cmake'), 'utf8').split('\\n').filter(line => /^set\\(CMAKE_CXX_COMPILER/.test(line)).slice(0,7); } catch { return []; } }) }));
    assert.equal(second.outcome, 'REUSED'); assert.equal(second.testCount, 1);
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
