import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { performance } from 'node:perf_hooks';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const digest = value => sha(JSON.stringify(value));
const inside = (root, file) => { const r = relative(root, file); return r !== '' && r !== '..' && !r.startsWith(`..${sep}`) && !isAbsolute(r); };
function run(exe, args, cwd) {
  const r = spawnSync(exe, args, { cwd, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, windowsHide: true });
  if (r.error || r.status !== 0) throw new Error(`${basename(exe)} failed (${r.status ?? 'spawn'}): ${(r.stderr || r.error?.message || r.stdout || '').slice(-2000)}`);
  return r.stdout;
}
function fileHash(path) { return sha(readFileSync(path)); }
function sourceFingerprint(root, build, store) {
  const paths = run('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], root).split('\0').filter(Boolean).sort();
  const hash = createHash('sha256');
  for (const name of paths) {
    const path = resolve(root, name);
    if (!inside(root, path) || path === build || inside(build, path) || path === store || inside(store, path)) throw new Error('Untracked build/store or unsafe source path: ' + name);
    hash.update(name); hash.update('\0'); hash.update(readFileSync(path)); hash.update('\0');
  }
  return hash.digest('hex');
}
function cacheSource(cache) {
  const match = cache.match(/^CMAKE_HOME_DIRECTORY:INTERNAL=(.+)$/m);
  if (!match) throw new Error('CMake source provenance unavailable');
  return resolve(match[1].trim());
}
function compilerHashes(cache, build) {
  const out = {};
  for (const key of ['CMAKE_C_COMPILER', 'CMAKE_CXX_COMPILER']) {
    const match = cache.match(new RegExp(`^${key}:(?:FILEPATH|STRING)=(.+)$`, 'm'));
    let path = match?.[1]?.trim();
    const metadata = [], candidates = [];
    for (const dir of readdirSync(join(build, 'CMakeFiles'), { withFileTypes: true })) {
      if (!dir.isDirectory()) continue;
      const name = key === 'CMAKE_C_COMPILER' ? 'CMakeCCompiler.cmake' : 'CMakeCXXCompiler.cmake';
      const file = join(build, 'CMakeFiles', dir.name, name);
      if (!existsSync(file)) continue;
      const content = readFileSync(file, 'utf8');
      metadata.push([relative(build, file), sha(content)]);
      const prefix = `set(${key} "`;
      const line = content.split(String.fromCharCode(10)).map(value => value.trim()).find(value => value.startsWith(prefix));
      const candidate = line?.slice(prefix.length).split('"')[0];
      if (candidate) candidates.push(candidate);
    }
    const distinct = [...new Set(candidates.map(value => isAbsolute(value) ? resolve(value) : value))];
    if (distinct.length > 1 || (path && distinct.length && resolve(path) !== distinct[0])) return null;
    path ||= candidates[0];
    if (!path) continue;
    if (!isAbsolute(path) || !existsSync(path)) return null;
    out[key] = { path: realpathSync(path), sha256: fileHash(path), metadata: metadata.sort(([a], [b]) => a.localeCompare(b)) };
  }
  return Object.keys(out).length ? out : null;
}
/** A scoped, explicit-dependency CTest proof. Not a certificate of undeclared runtime dependencies. */
export function snapshotNative({ root, build, store, configuration = 'Release', runtimeFiles = [] }) {
  root = realpathSync(root); build = realpathSync(build); store = resolve(store);
  if (inside(root, store) || store === root) throw new Error('Evidence store must be outside the source repository');
  const cache = readFileSync(join(build, 'CMakeCache.txt'), 'utf8');
  if (realpathSync(cacheSource(cache)) !== root) throw new Error('CMake cache belongs to another source tree');
  const plan = JSON.parse(run('ctest', ['--test-dir', build, '-C', configuration, '--show-only=json-v1'], root));
  if (!Array.isArray(plan.tests) || !plan.tests.length) throw new Error('CTest contains no tests');
  // CTest exits 0 even when tests are disabled or skipped. Such a plan cannot certify full execution.
  const potentiallySkippedTests = plan.tests.filter(test => (test.properties || []).some(property =>
    (property.name === 'DISABLED' && property.value === true) ||
    property.name === 'SKIP_RETURN_CODE' || property.name === 'SKIP_REGULAR_EXPRESSION')).map(test => test.name);
  const executables = new Map(); let complete = potentiallySkippedTests.length === 0;
  for (const test of plan.tests) {
    const exe = test.command?.[0];
    if (!exe || !isAbsolute(exe) || !existsSync(exe) || !inside(build, realpathSync(exe))) { complete = false; continue; }
    executables.set(realpathSync(exe), fileHash(exe));
  }
  const compilers = compilerHashes(cache, build);
  if (!compilers) complete = false;
  const runtime = [];
  for (const path of runtimeFiles) {
    if (!existsSync(path)) { complete = false; continue; }
    runtime.push({ path: realpathSync(path), sha256: fileHash(path) });
  }
  runtime.sort((a, b) => a.path.localeCompare(b.path));
  const head = run('git', ['rev-parse', 'HEAD'], root).trim();
  const inputs = {
    root, build, configuration, head,
    source: sourceFingerprint(root, build, store), cache: sha(cache),
    testPlan: digest(plan.tests),
    executables: [...executables].sort(([a], [b]) => a.localeCompare(b)),
    compilers, runtime,
    cmake: run('cmake', ['--version'], root).split('\n')[0],
    ctest: run('ctest', ['--version'], root).split('\n')[0],
    environment: Object.fromEntries(['PATH', 'INCLUDE', 'LIB', 'CC', 'CXX', 'CMAKE_GENERATOR', 'CTEST_PARALLEL_LEVEL', 'LD_LIBRARY_PATH', 'DYLD_LIBRARY_PATH', 'SYSTEMROOT', 'WINDIR'].map(k => [k, process.env[k] ?? null])),
  };
  return { fingerprint: digest(inputs), inputs, testCount: plan.tests.length, complete, potentiallySkippedTests };
}
function readReceipt(path) {
  try {
    const value = JSON.parse(readFileSync(path, 'utf8'));
    const { integrity, ...body } = value;
    return integrity === digest(body) ? value : null;
  } catch { return null; }
}
/** Runs CMake's build authority before considering reuse; receipts are append-only. */
export function verifyNative({ root, build, store, configuration = 'Release', runtimeFiles = [], runtimeClosureDeclared = false }) {
  const started = performance.now();
  root = realpathSync(root); build = realpathSync(build); store = resolve(store);
  if (inside(root, store) || store === root) throw new Error('Evidence store must be outside the source repository');
  const sourceBeforeBuild = sourceFingerprint(root, build, store);
  const initialCache = readFileSync(join(build, 'CMakeCache.txt'), 'utf8');
  if (realpathSync(cacheSource(initialCache)) !== root) throw new Error('CMake cache belongs to another source tree');
  const buildStarted = performance.now();
  run('cmake', ['--build', build, '--config', configuration], root);
  const buildMs = performance.now() - buildStarted;
  const before = snapshotNative({ root, build, store, configuration, runtimeFiles });
  const sourceStableDuringBuild = sourceBeforeBuild === before.inputs.source;
  const reusable = runtimeClosureDeclared === true && before.complete && sourceStableDuringBuild;
  let reuseDecision = !runtimeClosureDeclared ? 'RUNTIME_CLOSURE_UNDECLARED'
    : !before.complete ? 'PROVENANCE_INCOMPLETE'
      : !sourceStableDuringBuild ? 'SOURCE_CHANGED_DURING_BUILD' : 'NO_RECEIPT';
  let changedInputs = [];
  if (reusable && existsSync(store)) {
    const files = readdirSync(store).filter(x => x.endsWith('.json')).sort().reverse();
    // A corrupt newest receipt fails closed: do not fall back to an older success.
    if (files.length) {
      const receipt = readReceipt(join(store, files[0]));
      if (!receipt) reuseDecision = 'RECEIPT_CORRUPT';
      else if (receipt.status !== 'PASS' || receipt.reusable !== true) reuseDecision = 'PREVIOUS_ATTEMPT_NOT_REUSABLE';
      else if (receipt.snapshot?.fingerprint !== before.fingerprint || receipt.snapshot?.testCount !== before.testCount) {
        reuseDecision = 'INPUT_CHANGED';
        changedInputs = Object.keys(before.inputs).filter(key => JSON.stringify(receipt.snapshot?.inputs?.[key]) !== JSON.stringify(before.inputs[key]));
        if (receipt.snapshot?.testCount !== before.testCount) changedInputs.push('testCount');
      } else {
        return { outcome: 'REUSED', reuseDecision: 'CURRENT', changedInputs: [],
          testCount: before.testCount, buildMs, elapsedMs: performance.now() - started, receipt: files[0] };
      }
    }
  }
  const testStarted = performance.now();
  const result = spawnSync('ctest', ['--test-dir', build, '-C', configuration, '--output-on-failure'], { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, windowsHide: true });
  const testMs = performance.now() - testStarted;
  const after = snapshotNative({ root, build, store, configuration, runtimeFiles });
  const stable = sourceStableDuringBuild && before.fingerprint === after.fingerprint;
  const pass = !result.error && result.status === 0 && stable;
  const body = { schema: 1, status: pass ? 'PASS' : 'FAIL', reusable: pass && reusable,
    snapshot: before, command: ['ctest', '--test-dir', build, '-C', configuration, '--output-on-failure'],
    exitCode: result.status, error: result.error?.message ?? null, stable,
    stdout: result.stdout ?? '', stderr: result.stderr ?? '', buildMs, testMs, reuseDecision, changedInputs };
  const receipt = { ...body, integrity: digest(body) };
  mkdirSync(store, { recursive: true });
  const filename = `${new Date().toISOString().replaceAll(':', '-')}-${randomUUID()}.json`;
  writeFileSync(join(store, filename), JSON.stringify(receipt, null, 2), { flag: 'wx' });
  return { outcome: pass ? 'EXECUTED' : 'FAILED', reuseDecision, changedInputs,
    testCount: before.testCount, reusable: receipt.reusable,
    buildMs, testMs, elapsedMs: performance.now() - started, receipt: filename, exitCode: result.status, stable };
}

export function runNativeCli(args) {
  const get = flag => { const i = args.indexOf(flag); return i < 0 ? undefined : args[i + 1]; };
  try {
    if (!get('--root') || !get('--build') || !get('--store')) throw new Error('Usage: indro verify-native --root PATH --build PATH --store PATH [--configuration Release] [--runtime-file PATH ...] [--declare-runtime-closure]');
    const runtimeFiles = args.flatMap((value, index) => value === '--runtime-file' && args[index + 1] ? [args[index + 1]] : []);
    const result = verifyNative({ root: get('--root'), build: get('--build'), store: get('--store'), configuration: get('--configuration') || 'Release', runtimeFiles, runtimeClosureDeclared: args.includes('--declare-runtime-closure') });
    console.log(JSON.stringify(result));
    return result.outcome === 'FAILED' ? 1 : 0;
  } catch (error) { console.error('INDRO_NATIVE_VERIFY_ERROR ' + error.message); return 2; }
}
