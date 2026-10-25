import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, appendFileSync, symlinkSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { snapshotNative, verifyNative, changedExecutablePaths } from './native-verify.mjs';

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
    assert.equal(second.outcome, recorded.fingerprint === current.fingerprint ? 'REUSED' : 'EXECUTED', JSON.stringify({ changed })); assert.equal(second.testCount, 1);
    assert.equal(second.reuseDecision, second.outcome === 'REUSED' ? 'CURRENT' : 'INPUT_CHANGED');
    assert.deepEqual(second.changedInputs.sort(), changed.sort());
    assert.ok(second.elapsedMs >= second.buildMs);
  } finally { rmSync(f.parent, { recursive: true, force: true }); }
});

test('Git, CMake and CTest executable bytes participate in proof identity', () => {
  const f = fixture();
  try {
    const first = verifyNative(f);
    assert.equal(first.outcome, 'EXECUTED');
    const snapshot = snapshotNative(f);
    assert.equal(snapshot.complete, true);
    for (const name of ['git', 'cmake', 'ctest']) {
      assert.ok(snapshot.inputs.tools[name]?.path, name);
      assert.match(snapshot.inputs.tools[name].sha256, /^[a-f0-9]{64}$/, name);
    }
    const file = join(f.store, first.receipt);
    const receipt = JSON.parse(readFileSync(file, 'utf8'));
    receipt.snapshot.inputs.tools.ctest.sha256 = '0'.repeat(64);
    receipt.snapshot.fingerprint = createHash('sha256').update(JSON.stringify(receipt.snapshot.inputs)).digest('hex');
    const { integrity, ...body } = receipt;
    receipt.integrity = createHash('sha256').update(JSON.stringify(body)).digest('hex');
    writeFileSync(file, JSON.stringify(receipt));
    const rerun = verifyNative(f);
    assert.equal(rerun.outcome, 'EXECUTED');
    assert.equal(rerun.reuseDecision, 'INPUT_CHANGED');
    assert.ok(rerun.changedInputs.includes('tools'));
  } finally { rmSync(f.parent, { recursive: true, force: true }); }
});

test('source changes invalidate proof even if output binary is identical', () => {
  const f = fixture();
  try {
    assert.equal(verifyNative(f).outcome, 'EXECUTED');
    appendFileSync(join(f.root, 'probe.cpp'), '\n// source changed\n');
    const rerun = verifyNative(f);
    assert.equal(rerun.outcome, 'EXECUTED');
    assert.equal(rerun.reuseDecision, 'INPUT_CHANGED');
    assert.ok(rerun.changedInputs.includes('source'));
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
    const rerun = verifyNative(f);
    assert.equal(rerun.outcome, 'EXECUTED');
    assert.equal(rerun.reuseDecision, 'RECEIPT_CORRUPT');
    assert.deepEqual(rerun.changedInputs, []);
  } finally { rmSync(f.parent, { recursive: true, force: true }); }
});

test('receipt with recomputed outer digest but inconsistent snapshot is rejected', () => {
  const f = fixture();
  try {
    assert.equal(verifyNative(f).outcome, 'EXECUTED');
    const file = join(f.store, readdirSync(f.store)[0]);
    const receipt = JSON.parse(readFileSync(file, 'utf8'));
    receipt.snapshot.inputs.source = 'forged-source';
    const { integrity, ...body } = receipt;
    receipt.integrity = createHash('sha256').update(JSON.stringify(body)).digest('hex');
    writeFileSync(file, JSON.stringify(receipt));
    const rerun = verifyNative(f);
    assert.equal(rerun.outcome, 'EXECUTED');
    assert.equal(rerun.reuseDecision, 'RECEIPT_CORRUPT');
  } finally { rmSync(f.parent, { recursive: true, force: true }); }
});

test('undeclared runtime closure forces execution', () => {
  const f = fixture();
  try {
    const unsafe = { ...f, runtimeClosureDeclared: false };
    const first = verifyNative(unsafe), second = verifyNative(unsafe);
    assert.equal(first.reusable, false);
    assert.equal(first.reuseDecision, 'RUNTIME_CLOSURE_UNDECLARED');
    assert.equal(second.outcome, 'EXECUTED');
    assert.equal(second.reuseDecision, 'RUNTIME_CLOSURE_UNDECLARED');
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
    const first = verifyNative(options), second = verifyNative(options);
    assert.equal(first.outcome, 'EXECUTED');
    const recorded = JSON.parse(readFileSync(join(f.store, first.receipt), 'utf8')).snapshot;
    assert.equal(second.outcome, recorded.fingerprint === snapshotNative(options).fingerprint ? 'REUSED' : 'EXECUTED');
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

test('conflicting CMake compiler metadata fails closed', () => {
  const f = fixture();
  try {
    assert.equal(verifyNative(f).outcome, 'EXECUTED');
    const conflict = join(f.build, 'CMakeFiles', 'conflicting-toolchain');
    mkdirSync(conflict);
    writeFileSync(join(conflict, 'CMakeCXXCompiler.cmake'), 'set(CMAKE_CXX_COMPILER "C:/indro/conflicting-cl.exe")\n');
    const snapshot = snapshotNative(f);
    assert.equal(snapshot.complete, false);
    assert.equal(snapshot.inputs.compilers, null);
  } finally { rmSync(f.parent, { recursive: true, force: true }); }
});


test('executable diagnostics identify changed, added and removed binaries', () => {
  const build = join(tmpdir(), 'indro-native-diagnostic-build');
  const a = join(build, 'bin', 'a.exe'), b = join(build, 'bin', 'b.exe');
  assert.deepEqual(changedExecutablePaths([[a, 'old'], [b, 'same']], [[a, 'new'], [b, 'same']], build), ['bin/a.exe']);
  assert.deepEqual(changedExecutablePaths([[a, 'old']], [[b, 'new']], build), ['bin/a.exe', 'bin/b.exe']);
  assert.deepEqual(changedExecutablePaths(null, [], build), []);
});

test('same-byte source symlink retarget invalidates native evidence', { skip: process.platform === 'win32' }, () => {
  const f = fixture();
  try {
    writeFileSync(join(f.root, 'left.dat'), 'identical');
    writeFileSync(join(f.root, 'right.dat'), 'identical');
    const alias = join(f.root, 'alias.dat');
    symlinkSync('left.dat', alias);
    const first = verifyNative(f);
    assert.equal(first.outcome, 'EXECUTED');
    const original = snapshotNative(f).inputs.source;
    unlinkSync(alias);
    symlinkSync('right.dat', alias);
    assert.notEqual(snapshotNative(f).inputs.source, original);
    const second = verifyNative(f);
    assert.equal(second.outcome, 'EXECUTED');
    assert.equal(second.reuseDecision, 'INPUT_CHANGED');
    assert.ok(second.changedInputs.includes('source'));
  } finally { rmSync(f.parent, { recursive: true, force: true }); }
});

test('recomputed receipt checksum cannot authorize contradictory reusable execution', () => {
  const f = fixture();
  try {
    assert.equal(verifyNative(f).outcome, 'EXECUTED');
    const mutations = [
      ['nonzero exit', receipt => { receipt.exitCode = 1; }],
      ['unstable inputs', receipt => { receipt.stable = false; }],
      ['incomplete provenance', receipt => { receipt.snapshot.complete = false; }],
      ['skipped test', receipt => { receipt.snapshot.potentiallySkippedTests = ['probe']; }],
      ['different command', receipt => { receipt.command = ['node', 'fake-test']; }],
    ];
    for (const [label, mutate] of mutations) {
      const latest = readdirSync(f.store).filter(name => name.endsWith('.json')).sort().at(-1);
      const path = join(f.store, latest);
      const receipt = JSON.parse(readFileSync(path, 'utf8'));
      mutate(receipt);
      const { integrity, ...body } = receipt;
      receipt.integrity = createHash('sha256').update(JSON.stringify(body)).digest('hex');
      writeFileSync(path, JSON.stringify(receipt));
      const rerun = verifyNative(f);
      assert.equal(rerun.outcome, 'EXECUTED', label);
      assert.equal(rerun.reuseDecision, 'RECEIPT_CORRUPT', label);
    }
  } finally { rmSync(f.parent, { recursive: true, force: true }); }
});

test('NUL-containing source bytes cannot impersonate another file record', () => {
  const f = fixture();
  try {
    const a = join(f.root, 'a'), b = join(f.root, 'b');
    // Previously: a = "X\\0b\\0FILE:false\\0Y" hashed identically to a = "X", b = "Y".
    writeFileSync(a, Buffer.from('X\\0b\\0FILE:false\\0Y'.replaceAll('\\0', '\\x00')));
    const first = verifyNative(f);
    assert.equal(first.outcome, 'EXECUTED');
    const previous = snapshotNative(f).inputs.source;
    writeFileSync(a, 'X');
    writeFileSync(b, 'Y');
    assert.notEqual(snapshotNative(f).inputs.source, previous);
    const rerun = verifyNative(f);
    assert.equal(rerun.outcome, 'EXECUTED');
    assert.equal(rerun.reuseDecision, 'INPUT_CHANGED');
    assert.ok(rerun.changedInputs.includes('source'));
  } finally { rmSync(f.parent, { recursive: true, force: true }); }
});
