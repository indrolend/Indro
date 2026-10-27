#!/usr/bin/env node
// Read-only source benchmark: build products and append-only evidence go to caller-selected paths.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

const cli = resolve(dirname(fileURLToPath(import.meta.url)), './cli.mjs');
const args = process.argv.slice(2), opts = new Map(), runtimeFiles = [];
let closureDeclared = false;
const flags = new Set(['--root', '--build', '--store', '--output', '--configuration', '--runs', '--runtime-file']);
for (let i = 0; i < args.length; i++) {
  const key = args[i];
  if (key === '--declare-runtime-closure') { if (closureDeclared) throw new Error('Duplicate closure declaration'); closureDeclared = true; continue; }
  if (!flags.has(key)) throw new Error(`Unknown argument ${key}`);
  const value = args[++i];
  if (!value || value.startsWith('--')) throw new Error(`Missing value for ${key}`);
  if (key === '--runtime-file') runtimeFiles.push(value);
  else if (opts.has(key)) throw new Error(`Duplicate argument ${key}`);
  else opts.set(key, value);
}
const required = ['--root', '--build', '--store', '--output'];
if (required.some(key => !opts.has(key))) throw new Error('Usage: node benchmark-native.mjs --root DIR --build DIR --store NEW_DIR --output NEW_FILE [--runs 5] [--runtime-file PATH ...] --declare-runtime-closure');
const root = realpathSync(opts.get('--root'));
const build = realpathSync(opts.get('--build'));
const store = resolve(opts.get('--store'));
const output = resolve(opts.get('--output'));
const config = opts.get('--configuration') || 'Release';
const runs = Number(opts.get('--runs') || '5');
if (!Number.isInteger(runs) || runs < 2 || runs > 30) throw new Error('Runs must be 2..30');
if (!closureDeclared) throw new Error('Explicit --declare-runtime-closure required; benchmark cannot infer runtime dependency closure');
const inside = (a, b) => { const r = relative(a, b); return r === '' || (r !== '..' && !r.startsWith(`..${sep}`) && !isAbsolute(r)); };
if (inside(root, store) || inside(root, output) || inside(build, store) || inside(build, output) || inside(store, output)) throw new Error('Store and output must be outside source/build');
const outputParent = realpathSync(dirname(output));
if (inside(root, outputParent) || inside(build, outputParent)) throw new Error('Output parent resolves inside source/build');
if (existsSync(output)) throw new Error('Output exists; refusing to overwrite');
if (existsSync(store) && readdirSync(store).length) throw new Error('Store is not empty; fresh benchmark requires a new evidence store');
if (!existsSync(cli)) throw new Error('INDRO CLI unavailable: ' + cli);
mkdirSync(store, { recursive: true });
const records = [];
const evidenceSnapshot = () => Object.fromEntries(readdirSync(store, { withFileTypes: true }).map(entry => {
  if (!entry.isFile()) throw new Error('Unexpected non-file evidence entry: ' + entry.name);
  return [entry.name, createHash('sha256').update(readFileSync(resolve(store, entry.name))).digest('hex')];
}).sort(([a], [b]) => a.localeCompare(b)));
const sameEvidence = (before, after) => JSON.stringify(before) === JSON.stringify(after);
function execute(kind, command, argv) {
  const started = performance.now();
  const r = spawnSync(command, argv, { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, windowsHide: true });
  const ms = performance.now() - started;
  const record = { kind, command, argv, elapsedMs: Math.round(ms * 100) / 100, exitCode: r.status, error: r.error?.message ?? null, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
  if (kind.startsWith('indro')) {
    try { Object.assign(record, JSON.parse((r.stdout || '').trim().split(/\r?\n/).at(-1))); }
    catch { record.parseError = true; }
  } else if (kind === 'ctest') {
    record.testCount = Number((r.stdout || '').match(/out of (\d+)/)?.[1] ?? -1);
  }
  records.push(record);
  if (r.error || r.status !== 0) throw new Error(`${kind} failed: ${(r.stderr || r.stdout || r.error?.message || '').slice(-1500)}`);
  return record;
}
let error = null, reuseStatus = 'NOT_RUN', invalidation = null;
try {
  // INDRO requires an explicit runtime-closure claim for evidence reuse. This
  // benchmark does not infer or silently declare that closure on the user's behalf.
  const closure = ['--declare-runtime-closure'];
  const indroArgs = [cli, 'verify-native', '--root', root, '--build', build, '--store', store,
    '--configuration', config, ...runtimeFiles.flatMap(file => ['--runtime-file', resolve(file)]), ...closure];
  const baseline = () => { execute('cmake-build', 'cmake', ['--build', build, '--config', config]); return execute('ctest', 'ctest', ['--test-dir', build, '-C', config, '--output-on-failure']); };
  baseline();
  const first = execute('indro-first', process.execPath, indroArgs);
  if (first.outcome !== 'EXECUTED' || first.reusable !== true) throw new Error('First INDRO run was not a reusable execution; inspect provenance and runtime closure');
  const initialCount = records.find(record => record.kind === 'ctest')?.testCount;
  if (!(initialCount > 0) || first.testCount !== initialCount) throw new Error('First INDRO test coverage differs from baseline');
  const originalEvidence = evidenceSnapshot();
  reuseStatus = 'REUSED';
  if (!Object.hasOwn(originalEvidence, first.receipt)) throw new Error('First INDRO receipt not found in evidence store');
  for (let i = 0; i < runs; i++) {
    const ordinary = baseline();
    const reused = execute('indro-reuse', process.execPath, indroArgs);
    if (reused.outcome === 'EXECUTED') {
      // A baseline build can legitimately change a binary (notably on Windows).
      // Report this as a negative reuse result; never label it a speedup.
      reuseStatus = 'INVALIDATED';
      invalidation = { repetition: i + 1, reason: reused.reuseDecision, changedInputs: reused.changedInputs ?? [] };
      break;
    }
    if (reused.outcome !== 'REUSED') throw new Error(`INDRO verification failed at repetition ${i + 1}: ${reused.reuseDecision ?? reused.outcome}`);
    if (ordinary.testCount !== reused.testCount) throw new Error(`CTest coverage mismatch: ${ordinary.testCount} vs ${reused.testCount}`);
    if (reused.receipt !== first.receipt || !sameEvidence(originalEvidence, evidenceSnapshot()))
      throw new Error('Reuse altered evidence or changed receipt identity');
  }
} catch (e) { error = String(e.message || e); }
const values = kind => records.filter(x => x.kind === kind).map(x => x.elapsedMs).sort((a,b)=>a-b);
const median = xs => xs.length ? (xs[Math.floor((xs.length-1)/2)] + xs[Math.floor(xs.length/2)]) / 2 : null;
const baselineTimes = [];
for (let i = 0; i < records.length; i++) if (records[i].kind === 'ctest') baselineTimes.push(records[i].elapsedMs + (records[i-1]?.kind === 'cmake-build' ? records[i-1].elapsedMs : 0));
const ordinaryMedian = median(baselineTimes.slice(1).sort((a,b)=>a-b));
const reuseMedian = median(values('indro-reuse'));
const report = { schema: 2, root, build, store, configuration: config, repetitions: runs, runtimeClosureAssumption: 'explicitly declared by benchmark operator; not independently established', runtimeFiles,
  records, ordinaryMedianMs: ordinaryMedian, reuseMedianMs: reuseMedian, reuseStatus, invalidation,
  speedup: reuseStatus === 'REUSED' && ordinaryMedian && reuseMedian ? ordinaryMedian / reuseMedian : null, error };
writeFileSync(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ output, ordinaryMedianMs: ordinaryMedian, reuseMedianMs: reuseMedian, reuseStatus, invalidation, speedup: report.speedup, error }));
if (error) process.exitCode = 1;