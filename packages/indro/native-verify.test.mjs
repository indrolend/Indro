import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, appendFileSync, symlinkSync, unlinkSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { snapshotNative, verifyNative, changedExecutablePaths } from './native-verify.mjs';

function fixture({ compilerWrapper = false, generator = null } = {}) {
  const parent = mkdtempSync(join(tmpdir(), 'indro-native-proof-'));
  const root = join(parent, 'source'), build = join(root, 'build'), store = join(parent, 'evidence');
  mkdirSync(root);
  const compiler = compilerWrapper ? join(parent, 'compiler-wrapper.sh') : null;
  if (compiler) {
    const cxx = execFileSync('which', ['c++'], { encoding: 'utf8' }).trim();
    writeFileSync(compiler, `#!/bin/sh\nexec "${cxx}" "$@"\n`);
    chmodSync(compiler, 0o755);
  }
  writeFileSync(join(root, '.gitignore'), 'build/\n');
  writeFileSync(join(root, 'CMakeLists.txt'), 'cmake_minimum_required(VERSION 3.16)\nproject(proof CXX)\nenable_testing()\nadd_executable(probe probe.cpp)\nadd_test(NAME probe COMMAND probe)\n');
  writeFileSync(join(root, 'probe.cpp'), '#include <iostream>\nint main(){std::cout << "PASS"; return 0;}\n');
  execFileSync('git', ['init', '-q', root]);
  execFileSync('git', ['-C', root, 'add', '.']);
  execFileSync('git', ['-C', root, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'fixture']);
  const configure = ['-S', root, '-B', build];
  if (generator) configure.push('-G', generator);
  if (compiler) configure.push(`-DCMAKE_CXX_COMPILER=${compiler}`);
  execFileSync('cmake', configure, { stdio: 'pipe' });
  return { parent, root, build, store, compiler, runtimeClosureDeclared: true };
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

test('staged Git index changes invalidate reuse despite unchanged working-tree bytes', () => {
  const f = fixture();
  try {
    writeFileSync(join(f.root, 'probe.cpp'),
      '#include <cstdlib>\nint main(){return std::system("git diff --cached --quiet") == 0 ? 0 : 1;}\n');
    const first = verifyNative(f);
    assert.equal(first.outcome, 'EXECUTED');
    const before = snapshotNative(f);
    const ignore = join(f.root, '.gitignore');
    const original = readFileSync(ignore, 'utf8');
    writeFileSync(ignore, original + '# staged only\n');
    execFileSync('git', ['-C', f.root, 'add', '.gitignore']);
    writeFileSync(ignore, original);
    assert.equal(readFileSync(ignore, 'utf8'), original);
    assert.notEqual(snapshotNative(f).inputs.source, before.inputs.source);
    const second = verifyNative(f);
    assert.equal(second.outcome, 'FAILED');
    assert.equal(second.reuseDecision, 'INPUT_CHANGED');
    assert.ok(second.changedInputs.includes('source'));
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

test('runtime location environment changes invalidate proof', () => {
  const f = fixture();
  const key = process.platform === 'win32' ? 'TEMP' : 'HOME';
  const previous = process.env[key];
  try {
    const first = verifyNative(f);
    assert.equal(first.outcome, 'EXECUTED');
    process.env[key] = join(f.parent, 'changed-runtime-location');
    const rerun = verifyNative(f);
    assert.equal(rerun.outcome, 'EXECUTED');
    assert.equal(rerun.reuseDecision, 'INPUT_CHANGED');
    assert.ok(rerun.changedInputs.includes('environment'));
  } finally {
    if (previous === undefined) delete process.env[key];
    else process.env[key] = previous;
    rmSync(f.parent, { recursive: true, force: true });
  }
});

test('unlisted runtime environment changes invalidate reuse before CTest execution', () => {
  const f = fixture();
  const key = 'INDRO_NATIVE_VERIFY_UNLISTED_ENV';
  const previous = process.env[key];
  try {
    writeFileSync(join(f.root, 'probe.cpp'),
      '#include <cstdlib>\n#include <cstring>\nint main(){const char* x=std::getenv("INDRO_NATIVE_VERIFY_UNLISTED_ENV");return x && std::strcmp(x,"pass")==0 ? 0 : 3;}\n');
    process.env[key] = 'pass';
    const first = verifyNative(f);
    assert.equal(first.outcome, 'EXECUTED');
    assert.equal(first.reusable, true);
    process.env[key] = 'fail';
    const second = verifyNative(f);
    assert.equal(second.outcome, 'FAILED');
    assert.equal(second.reuseDecision, 'INPUT_CHANGED');
    assert.ok(second.changedInputs.includes('environmentDigest'));
  } finally {
    if (previous === undefined) delete process.env[key];
    else process.env[key] = previous;
    rmSync(f.parent, { recursive: true, force: true });
  }
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
    writeFileSync(a, Buffer.concat([Buffer.from('X'), Buffer.from([0]), Buffer.from('b'), Buffer.from([0]), Buffer.from('FILE:false'), Buffer.from([0]), Buffer.from('Y')]));
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

test('CLI rejects missing, mistyped and duplicate runtime dependency options before building', () => {
  const cli = join(import.meta.dirname, 'cli.mjs');
  const common = ['--root', 'unused-root', '--build', 'unused-build', '--store', 'unused-store'];
  for (const [args, diagnostic] of [
    [['--declare-runtime-closure', '--runtime-file'], /Missing value for --runtime-file/],
    [['--runtime-file', '--declare-runtime-closure'], /Missing value for --runtime-file/],
    [['--declare-runtime-closure', '--runtime-fil', 'dependency.dat'], /Unknown verify-native argument/],
    [['--store', 'other-store'], /Duplicate verify-native argument: --store/],
  ]) {
    const result = spawnSync(process.execPath, [cli, 'verify-native', ...common, ...args], { encoding: 'utf8' });
    assert.equal(result.status, 2, JSON.stringify({ args, stderr: result.stderr }));
    assert.match(result.stderr, diagnostic);
  }
});


test('symlinked evidence store cannot redirect receipts into the source tree', { skip: process.platform === 'win32' }, () => {
  const f = fixture();
  try {
    const alias = join(f.parent, 'outside-looking-alias');
    symlinkSync(f.root, alias, 'dir');
    const options = { ...f, store: join(alias, 'evidence') };
    for (const existing of [false, true]) {
      if (existing) mkdirSync(join(f.root, 'evidence'));
      assert.throws(() => snapshotNative(options), /Evidence store must be outside/);
      assert.throws(() => verifyNative(options), /Evidence store must be outside/);
      assert.equal(existsSync(join(f.root, 'evidence')), existing);
    }
  } finally { rmSync(f.parent, { recursive: true, force: true }); }
});

test('same-byte executable permission change prevents evidence reuse', { skip: process.platform === 'win32' }, () => {
  const f = fixture();
  try {
    const first = verifyNative(f);
    assert.equal(first.outcome, 'EXECUTED');
    assert.equal(first.reusable, true);
    const executable = snapshotNative(f).inputs.executables[0][0];
    chmodSync(executable, 0o644);
    const snapshot = snapshotNative(f);
    assert.equal(snapshot.complete, false);
    const rerun = verifyNative(f);
    assert.equal(rerun.outcome, 'FAILED');
    assert.equal(rerun.reusable, false);
    assert.notEqual(rerun.exitCode, 0);
    assert.equal(rerun.reuseDecision, 'PROVENANCE_INCOMPLETE');
  } finally { rmSync(f.parent, { recursive: true, force: true }); }
});

test('declared runtime executable permission change invalidates proof', { skip: process.platform === 'win32' }, () => {
  const f = fixture();
  try {
    const dependency = join(f.parent, 'runtime-script.sh');
    writeFileSync(dependency, '#!/bin/sh\nexit 0\n');
    chmodSync(dependency, 0o755);
    const options = { ...f, runtimeFiles: [dependency] };
    const first = verifyNative(options);
    assert.equal(first.outcome, 'EXECUTED');
    assert.equal(first.reusable, true);
    const before = snapshotNative(options);
    chmodSync(dependency, 0o644);
    const after = snapshotNative(options);
    assert.notEqual(after.fingerprint, before.fingerprint);
    const rerun = verifyNative(options);
    assert.equal(rerun.outcome, 'EXECUTED');
    assert.equal(rerun.reuseDecision, 'INPUT_CHANGED');
    assert.ok(rerun.changedInputs.includes('runtime'));
  } finally { rmSync(f.parent, { recursive: true, force: true }); }
});


test('declared runtime symlink text invalidates reuse even when target bytes match', { skip: process.platform === 'win32' }, () => {
  const f = fixture();
  const key = 'INDRO_NATIVE_RUNTIME_ALIAS', previous = process.env.INDRO_NATIVE_RUNTIME_ALIAS;
  try {
    const target = join(f.parent, 'runtime.dat'), alias = join(f.parent, 'runtime-alias.dat');
    writeFileSync(target, 'unchanged');
    symlinkSync('runtime.dat', alias);
    process.env[key] = alias;
    writeFileSync(join(f.root, 'probe.cpp'),
      '#include <cstdlib>\n#include <string>\n#include <unistd.h>\nint main(){const char* p=std::getenv("INDRO_NATIVE_RUNTIME_ALIAS");if(!p)return 2;char b[1024];ssize_t n=readlink(p,b,sizeof(b));return n>0 && std::string(b,n)=="runtime.dat" ? 0 : 7;}\n');
    const options = { ...f, runtimeFiles: [alias] };
    const first = verifyNative(options);
    assert.equal(first.outcome, 'EXECUTED');
    assert.equal(first.reusable, true);
    const before = snapshotNative(options).fingerprint;
    unlinkSync(alias);
    symlinkSync('./runtime.dat', alias);
    assert.notEqual(snapshotNative(options).fingerprint, before);
    const second = verifyNative(options);
    assert.equal(second.outcome, 'FAILED');
    assert.equal(second.reuseDecision, 'INPUT_CHANGED');
    assert.ok(second.changedInputs.includes('runtime'));
    assert.equal(second.reusable, false);
  } finally {
    if (previous === undefined) delete process.env[key];
    else process.env[key] = previous;
    rmSync(f.parent, { recursive: true, force: true });
  }
});

test('nested CMake source cannot inherit a different Git worktree root', () => {
  const f = fixture();
  try {
    const nested = join(f.root, 'nested');
    mkdirSync(nested);
    writeFileSync(join(nested, 'CMakeLists.txt'),
      'cmake_minimum_required(VERSION 3.16)\nproject(nested CXX)\nenable_testing()\nadd_executable(probe probe.cpp)\nadd_test(NAME probe COMMAND probe)\n');
    writeFileSync(join(nested, 'probe.cpp'), 'int main(){return 0;}\n');
    const build = join(nested, 'build');
    execFileSync('cmake', ['-S', nested, '-B', build], { stdio: 'pipe' });
    const options = { ...f, root: nested, build };
    assert.throws(() => snapshotNative(options), /Source root must match Git worktree root/);
    assert.throws(() => verifyNative(options), /Source root must match Git worktree root/);
  } finally { rmSync(f.parent, { recursive: true, force: true }); }
});

test('compiler executable permission loss prevents reuse after no-op build', { skip: process.platform === 'win32' }, () => {
  const f = fixture({ compilerWrapper: true });
  try {
    const first = verifyNative(f);
    assert.equal(first.outcome, 'EXECUTED');
    assert.equal(first.reusable, true);
    const before = snapshotNative(f);
    chmodSync(f.compiler, 0o644);
    const after = snapshotNative(f);
    assert.equal(after.complete, false);
    assert.notEqual(after.fingerprint, before.fingerprint);
    const rerun = verifyNative(f);
    assert.equal(rerun.outcome, 'EXECUTED');
    assert.equal(rerun.reuseDecision, 'PROVENANCE_INCOMPLETE');
    assert.equal(rerun.reusable, false);
    assert.equal(rerun.exitCode, 0);
  } finally { rmSync(f.parent, { recursive: true, force: true }); }
});

test('CTest executable symlink text invalidates reuse despite unchanged binary bytes', { skip: process.platform === 'win32' }, () => {
  const f = fixture();
  try {
    writeFileSync(join(f.root, 'CMakeLists.txt'),
      'cmake_minimum_required(VERSION 3.16)\nproject(proof CXX)\nenable_testing()\nadd_executable(probe probe.cpp)\nadd_test(NAME probe COMMAND "${CMAKE_BINARY_DIR}/alias")\n');
    writeFileSync(join(f.root, 'probe.cpp'),
      '#include <unistd.h>\n#include <cstring>\nint main(int, char** argv){char b[1024];auto n=readlink(argv[0],b,sizeof(b));return n==5 && std::strncmp(b,"probe",5)==0 ? 0 : 7;}\n');
    execFileSync('cmake', ['-S', f.root, '-B', f.build], { stdio: 'pipe' });
    const alias = join(f.build, 'alias');
    symlinkSync('probe', alias);
    const first = verifyNative(f), reused = verifyNative(f);
    assert.equal(first.outcome, 'EXECUTED');
    assert.equal(first.reusable, true);
    assert.equal(reused.outcome, 'REUSED');
    unlinkSync(alias);
    symlinkSync('./probe', alias);
    const direct = spawnSync('ctest', ['--test-dir', f.build, '--output-on-failure'], { encoding: 'utf8' });
    assert.notEqual(direct.status, 0);
    const rerun = verifyNative(f);
    assert.equal(rerun.outcome, 'FAILED');
    assert.equal(rerun.reuseDecision, 'INPUT_CHANGED');
    assert.ok(rerun.changedInputs.includes('executables'));
    assert.ok(rerun.changedExecutables.includes('alias'));
    assert.equal(rerun.reusable, false);
  } finally { rmSync(f.parent, { recursive: true, force: true }); }
});

test('compiler symlink text invalidates reusable CTest evidence even when compiler bytes match', { skip: process.platform === 'win32' }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'indro-compiler-symlink-'));
  try {
    const root = join(dir, 'source'), build = join(root, 'build'), store = join(dir, 'evidence');
    mkdirSync(root); mkdirSync(join(dir, 'bin'));
    const wrapper = join(dir, 'bin', 'compiler.sh'), link = join(dir, 'bin', 'compiler-link');
    const cxx = execFileSync('which', ['c++'], { encoding: 'utf8' }).trim();
    writeFileSync(wrapper, '#!/bin/sh\nexec "' + cxx + '" "$@"\n'); chmodSync(wrapper, 0o755);
    symlinkSync('compiler.sh', link);
    writeFileSync(join(root, '.gitignore'), 'build/\n');
    writeFileSync(join(root, 'CMakeLists.txt'), 'cmake_minimum_required(VERSION 3.16)\nproject(proof CXX)\nenable_testing()\nadd_executable(probe probe.cpp)\nadd_test(NAME probe COMMAND probe)\n');
    writeFileSync(join(root, 'probe.cpp'), '#include <unistd.h>\n#include <string>\nint main(){char buf[4096]; auto n=readlink("' + link.replaceAll('\\', '\\\\') + '",buf,sizeof(buf));return n>0 && std::string(buf,n)=="compiler.sh" ? 0:1;}\n');
    execFileSync('git', ['init', '-q', root]);
    execFileSync('git', ['-C', root, 'add', '.']);
    execFileSync('git', ['-C', root, '-c', 'user.name=test', '-c', 'user.email=test@local', 'commit', '-qm', 'fixture']);
    execFileSync('cmake', ['-S', root, '-B', build, '-DCMAKE_CXX_COMPILER=' + link]);
    const opts = { root, build, store, runtimeClosureDeclared: true };
    assert.equal(verifyNative(opts).outcome, 'EXECUTED');
    assert.equal(verifyNative(opts).outcome, 'REUSED');
    unlinkSync(link); symlinkSync('./compiler.sh', link);
    const changed = verifyNative(opts);
    assert.equal(changed.outcome, 'FAILED', JSON.stringify(changed));
    assert.equal(changed.reuseDecision, 'INPUT_CHANGED');
    assert.ok(changed.changedInputs.includes('compilers'), JSON.stringify(changed));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('CTest tool symlink text invalidates proof despite unchanged executable bytes', { skip: process.platform === 'win32' }, () => {
  const f = fixture();
  const originalPath = process.env.PATH;
  try {
    const realCTest = execFileSync('which', ['ctest'], { encoding: 'utf8' }).trim();
    const bin = join(f.parent, 'tool-bin'); mkdirSync(bin);
    const driver = join(bin, 'ctest-driver'), link = join(bin, 'ctest');
    const script = ['#!/bin/sh', '"' + realCTest + '" "$@"', 'status=$?',
      'case " $* " in *" --output-on-failure "*) if [ "$(readlink "' + link + '")" != "ctest-driver" ]; then exit 8; fi;; esac',
      'exit "$status"'].join('\n') + '\n';
    writeFileSync(driver, script); chmodSync(driver, 0o755); symlinkSync('ctest-driver', link);
    process.env.PATH = bin + ':' + originalPath;
    assert.equal(verifyNative(f).outcome, 'EXECUTED');
    assert.equal(verifyNative(f).outcome, 'REUSED');
    const before = snapshotNative(f);
    unlinkSync(link); symlinkSync('./ctest-driver', link);
    const after = snapshotNative(f);
    assert.equal(before.inputs.tools.ctest.sha256, after.inputs.tools.ctest.sha256);
    assert.notEqual(before.fingerprint, after.fingerprint);
    const direct = spawnSync('ctest', ['--test-dir', f.build, '--output-on-failure'], { encoding: 'utf8' });
    assert.notEqual(direct.status, 0);
    const rerun = verifyNative(f);
    assert.equal(rerun.outcome, 'FAILED', JSON.stringify(rerun));
    assert.equal(rerun.reuseDecision, 'INPUT_CHANGED');
    assert.ok(rerun.changedInputs.includes('tools'));
    assert.equal(rerun.reusable, false);
  } finally { process.env.PATH = originalPath; rmSync(f.parent, { recursive: true, force: true }); }
});

test('changed CMake generator entry point invalidates native evidence reuse', () => {
  const f = fixture();
  try {
    assert.equal(verifyNative(f).outcome, 'EXECUTED');
    // Visual Studio may regenerate its solution on a second build; compare the snapshot directly.
    if (process.platform !== 'win32') assert.equal(verifyNative(f).outcome, 'REUSED');
    const graph = readdirSync(f.build).find(name => name === 'Makefile' || name.endsWith('.ninja') || (name.endsWith('.sln') || name.endsWith('.slnx')));
    assert.ok(graph, 'expected CMake generator entry point');
    const before = snapshotNative(f);
    appendFileSync(join(f.build, graph), '\n# INDRO generated graph mutation\n');
    const after = snapshotNative(f);
    assert.notEqual(after.fingerprint, before.fingerprint);
    assert.notDeepEqual(after.inputs.buildGraph, before.inputs.buildGraph);
    if (process.platform !== 'win32') {
      const rerun = verifyNative(f);
      assert.equal(rerun.outcome, 'EXECUTED');
      assert.equal(rerun.reuseDecision, 'INPUT_CHANGED');
      assert.ok(rerun.changedInputs.includes('buildGraph'));
    }
  } finally { rmSync(f.parent, { recursive: true, force: true }); }
});

test('missing CMake generator entry point prevents reusable proof', () => {
  const f = fixture();
  try {
    assert.equal(verifyNative(f).outcome, 'EXECUTED');
    const graph = readdirSync(f.build).find(name => name === 'Makefile' || name.endsWith('.ninja') || (name.endsWith('.sln') || name.endsWith('.slnx')));
    assert.ok(graph, 'expected CMake generator entry point');
    unlinkSync(join(f.build, graph));
    const snapshot = snapshotNative(f);
    assert.equal(snapshot.complete, false);
    assert.equal(snapshot.inputs.buildGraph, null);
  } finally { rmSync(f.parent, { recursive: true, force: true }); }
});

test('per-target Makefile compiler flags invalidate reusable CTest evidence', { skip: process.platform === 'win32' }, () => {
  const f = fixture();
  try {
    assert.equal(verifyNative(f).outcome, 'EXECUTED');
    assert.equal(verifyNative(f).outcome, 'REUSED');
    const flags = join(f.build, 'CMakeFiles', 'probe.dir', 'flags.make');
    assert.ok(existsSync(flags), 'requires Unix Makefiles generator');
    const before = snapshotNative(f);
    appendFileSync(flags, '\n# changed generated compiler flags\n');
    assert.notEqual(snapshotNative(f).fingerprint, before.fingerprint);
    const rerun = verifyNative(f);
    assert.equal(rerun.outcome, 'EXECUTED');
    assert.equal(rerun.reuseDecision, 'INPUT_CHANGED');
    assert.ok(rerun.changedInputs.includes('buildGraph'));
  } finally { rmSync(f.parent, { recursive: true, force: true }); }
});

test('Visual Studio project edits change build graph provenance', { skip: process.platform !== 'win32' }, () => {
  const f = fixture();
  try {
    assert.equal(verifyNative(f).outcome, 'EXECUTED');
    const project = readdirSync(f.build).find(name => name.endsWith('.vcxproj'));
    assert.ok(project, 'requires Visual Studio generator');
    const before = snapshotNative(f);
    appendFileSync(join(f.build, project), '\n<!-- changed generated project -->\n');
    assert.notEqual(snapshotNative(f).fingerprint, before.fingerprint);
  } finally { rmSync(f.parent, { recursive: true, force: true }); }
});

test('Ninja Multi-Config implementation rules invalidate reusable CTest evidence', { skip: process.platform === 'win32' || spawnSync('ninja', ['--version']).status !== 0 }, () => {
  const f = fixture({ generator: 'Ninja Multi-Config' });
  try {
    assert.equal(verifyNative(f).outcome, 'EXECUTED');
    assert.equal(verifyNative(f).outcome, 'REUSED');
    const impl = join(f.build, 'CMakeFiles', 'impl-Release.ninja');
    assert.ok(existsSync(impl), 'expected generated per-configuration Ninja rules');
    const before = snapshotNative(f);
    appendFileSync(impl, '\n# changed per-configuration build instructions\n');
    const after = snapshotNative(f);
    assert.notEqual(after.fingerprint, before.fingerprint);
    assert.notDeepEqual(after.inputs.buildGraph, before.inputs.buildGraph);
    const rerun = verifyNative(f);
    assert.equal(rerun.outcome, 'EXECUTED', JSON.stringify(rerun));
    assert.equal(rerun.reuseDecision, 'INPUT_CHANGED');
    assert.ok(rerun.changedInputs.includes('buildGraph'));
  } finally { rmSync(f.parent, { recursive: true, force: true }); }
});
