import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, parse, relative, resolve, sep } from 'node:path';
import { performance } from 'node:perf_hooks';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const digest = value => sha(JSON.stringify(value));
const inside = (root, file) => { const r = relative(root, file); return r !== '' && r !== '..' && !r.startsWith(`..${sep}`) && !isAbsolute(r); };
function assertExternalEvidenceStore(root, store) {
  // Resolve the nearest existing ancestor so a symlink cannot redirect receipts into source.
  let ancestor = store;
  while (!existsSync(ancestor)) {
    const parent = dirname(ancestor);
    if (parent === ancestor) throw new Error('Evidence store path unavailable');
    ancestor = parent;
  }
  const physical = resolve(realpathSync(ancestor), relative(ancestor, store));
  if (physical === root || inside(root, physical)) throw new Error('Evidence store must be outside the source repository');
}
// Capture symlink text along the declared path, not only the resolved file bytes.
function pathSymlinks(path) {
  const absolute = resolve(path);
  let cursor = parse(absolute).root;
  const links = [];
  for (const component of absolute.slice(cursor.length).split(sep).filter(Boolean)) {
    cursor = join(cursor, component);
    if (lstatSync(cursor).isSymbolicLink()) links.push([cursor, readlinkSync(cursor)]);
  }
  return links;
}
function run(exe, args, cwd) {
  const r = spawnSync(exe, args, { cwd, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, windowsHide: true });
  if (r.error || r.status !== 0) throw new Error(`${basename(exe)} failed (${r.status ?? 'spawn'}): ${(r.stderr || r.error?.message || r.stdout || '').slice(-2000)}`);
  return r.stdout;
}
function assertGitRoot(root) {
  const prefix = run('git', ['rev-parse', '--show-prefix'], root).trim();
  if (prefix !== '') throw new Error('Source root must match Git worktree root');
}
function fileHash(path) { return sha(readFileSync(path)); }
function toolProvenance(name, cwd) {
  const locator = process.platform === 'win32' ? 'where.exe' : 'which';
  const found = spawnSync(locator, [name], { cwd, encoding: 'utf8', windowsHide: true });
  if (found.error || found.status !== 0) return null;
  const path = found.stdout.split(/\r?\n/).map(line => line.trim()).find(Boolean);
  if (!path || !isAbsolute(path) || !existsSync(path)) return null;
  try { return { path: realpathSync(path), sha256: fileHash(path) }; }
  catch { return null; }
}
// Length-frame each field: source bytes can contain NULs and must not mimic the next record.
function hashField(hash, value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value);
  const length = Buffer.alloc(8);
  length.writeBigUInt64BE(BigInt(bytes.length));
  hash.update(length); hash.update(bytes);
}
function sourceFingerprint(root, build, store) {
  const paths = run('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], root).split('\0').filter(Boolean).sort();
  const hash = createHash('sha256');
  // Git's staged index can affect CTest even when working-tree bytes are unchanged.
  hashField(hash, 'GIT_INDEX');
  hashField(hash, run('git', ['ls-files', '--stage', '-z'], root));
  for (const name of paths) {
    const path = resolve(root, name);
    if (!inside(root, path) || path === build || inside(build, path) || path === store || inside(store, path)) throw new Error('Untracked build/store or unsafe source path: ' + name);
    // Git tracks file type and symlink targets, not just dereferenced bytes.
    const stat = lstatSync(path);
    hashField(hash, name);
    if (stat.isSymbolicLink()) {
      if (!inside(root, realpathSync(path))) throw new Error('Source symlink escapes repository: ' + name);
      hashField(hash, 'SYMLINK:' + readlinkSync(path));
    } else if (stat.isFile()) {
      hashField(hash, 'FILE:' + String(Boolean(stat.mode & 0o111)));
    } else throw new Error('Unsupported source file type: ' + name);
    hashField(hash, readFileSync(path));
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
    const physical = realpathSync(path);
    const executableMode = process.platform === 'win32' ? null : lstatSync(physical).mode & 0o111;
    if (process.platform !== 'win32' && executableMode === 0) return null;
    out[key] = { path: physical, sha256: fileHash(path), metadata: metadata.sort(([a], [b]) => a.localeCompare(b)),
      ...(executableMode === null ? {} : { executableMode: executableMode.toString(8) }) };
  }
  return Object.keys(out).length ? out : null;
}
/** A scoped, explicit-dependency CTest proof. Not a certificate of undeclared runtime dependencies. */
export function snapshotNative({ root, build, store, configuration = 'Release', runtimeFiles = [] }) {
  root = realpathSync(root); build = realpathSync(build); store = resolve(store);
  assertGitRoot(root);
  assertExternalEvidenceStore(root, store);
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
    const resolvedExe = realpathSync(exe);
    const executableMode = lstatSync(resolvedExe).mode & 0o111;
    if (process.platform !== 'win32' && executableMode === 0) complete = false;
    executables.set(resolvedExe, `${fileHash(exe)}:${process.platform === 'win32' ? 'win32' : executableMode.toString(8)}`);
  }
  const compilers = compilerHashes(cache, build);
  const tools = Object.fromEntries(['cmake', 'ctest', 'git'].map(name => [name, toolProvenance(name, root)]));
  if (!compilers || Object.values(tools).some(value => !value)) complete = false;
  const runtime = [];
  for (const path of runtimeFiles) {
    if (!existsSync(path)) { complete = false; continue; }
    const physical = realpathSync(path);
    runtime.push({ declaredPath: resolve(path), path: physical, symlinks: pathSymlinks(path), sha256: fileHash(path),
      ...(process.platform === 'win32' ? {} : { executableMode: (lstatSync(physical).mode & 0o111).toString(8) }) });
  }
  runtime.sort((a, b) => a.path.localeCompare(b.path));
  const head = run('git', ['rev-parse', 'HEAD'], root).trim();
  const inputs = {
    root, build, configuration, head,
    source: sourceFingerprint(root, build, store), cache: sha(cache),
    testPlan: digest(plan.tests),
    executables: [...executables].sort(([a], [b]) => a.localeCompare(b)),
    compilers, tools, runtime,
    cmake: run('cmake', ['--version'], root).split('\n')[0],
    ctest: run('ctest', ['--version'], root).split('\n')[0],
    // Digest every inherited variable: arbitrary CTest dependencies must not escape the fingerprint.
    environmentDigest: digest(Object.entries(process.env).sort(([a], [b]) => a.localeCompare(b))),
    environment: Object.fromEntries(['PATH', 'INCLUDE', 'LIB', 'CC', 'CXX', 'CMAKE_GENERATOR', 'CTEST_PARALLEL_LEVEL',
      'LD_LIBRARY_PATH', 'DYLD_LIBRARY_PATH', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP', 'LOCALAPPDATA', 'HOME',
      'XDG_DATA_HOME'].map(k => [k, process.env[k] ?? null])),
  };
  return { fingerprint: digest(inputs), inputs, testCount: plan.tests.length, complete, potentiallySkippedTests };
}
/** Report changed CTest executables without exposing binary contents or hashes. */
export function changedExecutablePaths(recorded, current, build) {
  if (!Array.isArray(recorded) || !Array.isArray(current)) return [];
  const previous = new Map(recorded), latest = new Map(current);
  return [...new Set([...previous.keys(), ...latest.keys()])]
    .filter(path => previous.get(path) !== latest.get(path))
    .map(path => relative(build, path).replaceAll('\\', '/')).sort();
}
function readReceipt(path) {
  try {
    const value = JSON.parse(readFileSync(path, 'utf8'));
    const { integrity, ...body } = value;
    if (integrity !== digest(body)) return null;
    if (!value.snapshot?.inputs || value.snapshot.fingerprint !== digest(value.snapshot.inputs) ||
      !Number.isInteger(value.snapshot.testCount) || value.snapshot.testCount < 1) return null;
    // A self-consistent checksum is not enough: reusable success must agree with the recorded execution.
    if (value.reusable === true) {
      const expectedCommand = ['ctest', '--test-dir', value.snapshot.inputs.build, '-C',
        value.snapshot.inputs.configuration, '--output-on-failure'];
      if (value.status !== 'PASS' || value.exitCode !== 0 || value.stable !== true ||
        value.snapshot.complete !== true || !Array.isArray(value.snapshot.potentiallySkippedTests) ||
        value.snapshot.potentiallySkippedTests.length !== 0 ||
        JSON.stringify(value.command) !== JSON.stringify(expectedCommand)) return null;
    }
    return value;
  } catch { return null; }
}
/** Runs CMake's build authority before considering reuse; receipts are append-only. */
export function verifyNative({ root, build, store, configuration = 'Release', runtimeFiles = [], runtimeClosureDeclared = false }) {
  const started = performance.now();
  root = realpathSync(root); build = realpathSync(build); store = resolve(store);
  assertGitRoot(root);
  assertExternalEvidenceStore(root, store);
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
  let changedExecutables = [];
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
        changedExecutables = changedExecutablePaths(receipt.snapshot.inputs.executables, before.inputs.executables, build);
      } else {
        return { outcome: 'REUSED', reuseDecision: 'CURRENT', changedInputs: [], changedExecutables: [],
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
  return { outcome: pass ? 'EXECUTED' : 'FAILED', reuseDecision, changedInputs, changedExecutables,
    testCount: before.testCount, reusable: receipt.reusable,
    buildMs, testMs, elapsedMs: performance.now() - started, receipt: filename, exitCode: result.status, stable };
}

export function runNativeCli(args) {
  const valueFlags = new Set(['--root', '--build', '--store', '--configuration', '--runtime-file']);
  const values = new Map(), runtimeFiles = [];
  try {
    for (let i = 0; i < args.length; i++) {
      const flag = args[i];
      if (flag === '--declare-runtime-closure') continue;
      if (!valueFlags.has(flag)) throw new Error('Unknown verify-native argument: ' + flag);
      const value = args[++i];
      if (!value || value.startsWith('--')) throw new Error('Missing value for ' + flag);
      if (flag === '--runtime-file') runtimeFiles.push(value);
      else {
        if (values.has(flag)) throw new Error('Duplicate verify-native argument: ' + flag);
        values.set(flag, value);
      }
    }
    if (!values.get('--root') || !values.get('--build') || !values.get('--store')) throw new Error('Usage: indro verify-native --root PATH --build PATH --store PATH [--configuration Release] [--runtime-file PATH ...] [--declare-runtime-closure]');
    const result = verifyNative({ root: values.get('--root'), build: values.get('--build'), store: values.get('--store'),
      configuration: values.get('--configuration') || 'Release', runtimeFiles,
      runtimeClosureDeclared: args.includes('--declare-runtime-closure') });
    console.log(JSON.stringify(result));
    return result.outcome === 'FAILED' ? 1 : 0;
  } catch (error) { console.error('INDRO_NATIVE_VERIFY_ERROR ' + error.message); return 2; }
}
