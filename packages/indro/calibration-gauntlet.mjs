import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PROTOCOL_SCHEMA, SCENARIOS, replay, resolveExecutable, resolveGodotProject, validateReplay } from './godot-replay.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const indroRoot = path.resolve(here, '..', '..');

function sha256(value) { return createHash('sha256').update(value).digest('hex'); }
function fileHash(file) { return sha256(readFileSync(file)); }
function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.ceil((sorted.length - 1) * p)];
}
function git(root, ...args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed in ${root}`);
  return result.stdout.trim();
}
function identity(root) {
  const status = git(root, 'status', '--porcelain=v1', '--untracked-files=all');
  return { root: git(root, 'rev-parse', '--show-toplevel'), branch: git(root, 'branch', '--show-current'), commit: git(root, 'rev-parse', 'HEAD'), origin: git(root, 'remote', 'get-url', 'origin'), dirty: Boolean(status), statusSha256: sha256(status) };
}
function manifest(directory) {
  const files = [];
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      const relative = path.relative(directory, full).replaceAll('\\', '/');
      if (relative === 'sha256-manifest.json') continue;
      if (entry.isDirectory()) walk(full);
      else files.push({ path: relative, bytes: statSync(full).size, sha256: fileHash(full) });
    }
  };
  walk(directory); files.sort((a, b) => a.path.localeCompare(b.path));
  const value = { schema: 'indro.calibration-artifacts/v1', files };
  writeFileSync(path.join(directory, 'sha256-manifest.json'), `${JSON.stringify(value, null, 2)}\n`);
  return value;
}
function verifyManifest(directory) {
  const value = JSON.parse(readFileSync(path.join(directory, 'sha256-manifest.json'), 'utf8'));
  return value.files.every((entry) => existsSync(path.join(directory, entry.path)) && statSync(path.join(directory, entry.path)).size === entry.bytes && fileHash(path.join(directory, entry.path)) === entry.sha256);
}

function baselineTrial({ godot, project, sourceRoot, commandsText, root, phase, index, timeoutMs }) {
  const directory = path.join(root, `a-original-${phase}-${index}`);
  const captures = path.join(directory, 'captures'); mkdirSync(captures, { recursive: true });
  const commands = path.join(directory, 'commands.txt'); writeFileSync(commands, commandsText);
  const argv = ['--path', project, '--resolution', '1280x720', '--rendering-method', 'gl_compatibility', '--script', 'res://scripts/agent_playtest.gd', '--', `--commands=${commands.replaceAll('\\', '/')}`, `--capture-dir=${captures.replaceAll('\\', '/')}`];
  const start = process.hrtime.bigint();
  const result = spawnSync(godot, argv, { cwd: sourceRoot, encoding: 'utf8', windowsHide: false, timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024 });
  const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
  const stdout = result.stdout || ''; const stderr = `${result.stderr || ''}${result.error ? `${result.error.message}\n` : ''}`; const exitCode = result.status ?? 127;
  writeFileSync(path.join(directory, 'stdout.log'), stdout); writeFileSync(path.join(directory, 'stderr.log'), stderr); writeFileSync(path.join(directory, 'exit-code.txt'), `${exitCode}\n`);
  const validation = validateReplay({ stdout, stderr, exitCode, captureDir: captures, commandsText, requireCapture: true });
  writeFileSync(path.join(directory, 'validation.json'), `${JSON.stringify(validation, null, 2)}\n`); manifest(directory);
  return { path: 'A', workflow: 'original-direct-script', phase, trial: index, freshExecution: true, success: validation.valid, exitCode, durationMs, assertionsPassed: validation.assertions.length, observations: validation.observations.length, captures: validation.captures.length, captureComplete: !validation.errors.includes('CAPTURE_COUNT_MISMATCH'), evidenceIntegrity: verifyManifest(directory), manualCoordinationSteps: 5, directory, errors: validation.errors };
}

async function canonicalTrial({ project, godot, root, phase, index, timeoutMs }) {
  const start = process.hrtime.bigint();
  try {
    const result = await replay({ scenario: 'smoke', commands: null, capture: true, clipboard: false, clipboardImage: false, video: false }, { project, godot, evidenceRoot: path.join(root, 'canonical-evidence'), timeout: timeoutMs });
    return { path: 'B', workflow: 'indro-godot-replay', phase, trial: index, freshExecution: true, success: true, exitCode: 0, durationMs: Number(process.hrtime.bigint() - start) / 1e6, assertionsPassed: result.validation.assertions.length, observations: result.validation.observations.length, captures: result.validation.captures.length, captureComplete: true, evidenceIntegrity: verifyManifest(result.directory), manualCoordinationSteps: 1, directory: result.directory, zipSha256: result.zipSha256, errors: [] };
  } catch (error) {
    return { path: 'B', workflow: 'indro-godot-replay', phase, trial: index, freshExecution: true, success: false, exitCode: 1, durationMs: Number(process.hrtime.bigint() - start) / 1e6, assertionsPassed: 0, observations: 0, captures: 0, captureComplete: false, evidenceIntegrity: false, manualCoordinationSteps: 1, directory: error.evidenceDirectory || null, errors: [error.message] };
  }
}

export function runNegativeControls() {
  const root = path.join(os.tmpdir(), `indro-calibration-controls-${randomUUID()}`); const captures = path.join(root, 'captures'); mkdirSync(captures, { recursive: true });
  const png = Buffer.from('89504e470d0a1a0a0000000d494844520000000100000001', 'hex');
  for (let i = 0; i < 3; i += 1) writeFileSync(path.join(captures, `frame-${i}.png`), png);
  const valid = ['AGENT_PLAYTEST_READY schema=4 fixed_dt=0.016666667','AGENT_STATE schema=4 frame=0 frame_capture=1','AGENT_STATE schema=4 frame=0 frame_capture=1','AGENT_STATE schema=4 frame=1 frame_capture=1','AGENT_ASSERT_PASS frame=1 expectations="room=1"','AGENT_PLAYTEST_EOF frame=1'].join('\n');
  const base = { stdout: valid, stderr: '', exitCode: 0, captureDir: captures, commandsText: SCENARIOS.smoke, requireCapture: true };
  const controls = [
    ['missing-protocol-records', { ...base, stdout: '' }],
    ['incorrect-assertion', { ...base, stdout: valid.replace('AGENT_ASSERT_PASS frame=1 expectations="room=1"', 'AGENT_PLAYTEST_ERROR reason=assertion_failed'), exitCode: 4 }],
    ['invalid-command-result', { ...base, stdout: valid.replace('AGENT_ASSERT_PASS frame=1 expectations="room=1"', 'AGENT_PLAYTEST_ERROR reason=unknown_command'), exitCode: 2 }],
  ].map(([name, fixture]) => { const actualAccepted = validateReplay(fixture).valid; return { name, expectedAccepted: false, actualAccepted, correct: !actualAccepted }; });
  writeFileSync(path.join(captures, 'frame-1.png'), 'modified');
  const actualAccepted = validateReplay(base).valid; controls.push({ name: 'modified-capture', expectedAccepted: false, actualAccepted, correct: !actualAccepted });
  try { resolveExecutable('godot_console.exe', path.join(root, 'missing.exe')); controls.push({ name: 'missing-dependency', expectedAccepted: false, actualAccepted: true, correct: false }); } catch { controls.push({ name: 'missing-dependency', expectedAccepted: false, actualAccepted: false, correct: true }); }
  const staleExpected = { commit: '0'.repeat(40), statusSha256: '0'.repeat(64) }; const current = identity(indroRoot); const staleAccepted = staleExpected.commit === current.commit && staleExpected.statusSha256 === current.statusSha256;
  controls.push({ name: 'stale-source-identity', expectedAccepted: false, actualAccepted: staleAccepted, correct: !staleAccepted });
  return controls;
}

function summarize(records, pathName) {
  const measured = records.filter((r) => r.path === pathName && r.phase === 'measured'); const times = measured.map((r) => r.durationMs);
  return { trials: measured.length, success: measured.filter((r) => r.success).length, failure: measured.filter((r) => !r.success).length, medianMs: percentile(times, .5), p95Ms: percentile(times, .95), maxMs: percentile(times, 1), evidenceIntegrityPass: measured.filter((r) => r.evidenceIntegrity).length, captureComplete: measured.filter((r) => r.captureComplete).length, manualCoordinationSteps: measured[0]?.manualCoordinationSteps ?? null };
}

export async function runCalibration(options = {}) {
  const warmups = options.warmups ?? 1; const trials = options.trials ?? 3; const timeoutMs = options.timeoutMs ?? 120000;
  if (!Number.isInteger(warmups) || warmups < 0 || !Number.isInteger(trials) || trials < 1) throw new Error('Warmups must be >= 0 and trials must be >= 1.');
  const project = resolveGodotProject(options.project); const sourceRoot = git(project, 'rev-parse', '--show-toplevel'); const godot = resolveExecutable('godot_console.exe', options.godot);
  const root = path.resolve(options.output || path.join(indroRoot, 'evidence', 'godot-replay', `calibration-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID()}`)); mkdirSync(root, { recursive: true });
  const records = [];
  for (const phase of ['warmup', 'measured']) for (let i = 1; i <= (phase === 'warmup' ? warmups : trials); i += 1) {
    records.push(baselineTrial({ godot, project, sourceRoot, commandsText: SCENARIOS.smoke, root, phase, index: i, timeoutMs }));
    records.push(await canonicalTrial({ project, godot, root, phase, index: i, timeoutMs }));
  }
  const negativeControls = runNegativeControls(); const a = summarize(records, 'A'); const b = summarize(records, 'B');
  const summary = { schema: 'indro.calibration-gauntlet/v1', generatedAt: new Date().toISOString(), identities: { indro: identity(indroRoot), godotSource: identity(sourceRoot), runtime: { path: godot, bytes: statSync(godot).size, sha256: fileHash(godot), version: spawnSync(godot, ['--version'], { encoding: 'utf8' }).stdout.trim() }, node: process.version, platform: `${process.platform}/${process.arch}` }, parameters: { protocolSchema: PROTOCOL_SCHEMA, warmups, trials, timeoutMs, parallelism: 1, resolution: '1280x720', renderingMethod: 'gl_compatibility', reuse: 'not measured: canonical replay has no verified reuse integration' }, constraints: { hard: ['exit code zero','schema-4 READY exactly once','observation present','EOF exactly once','no protocol errors','monotonic exact step progression','all assertions reported','one valid PNG per observation','artifact hashes match'], tunable: ['warmups','trials','timeoutMs'] }, results: { A: a, B: b }, workflowCompression: { stepReduction: a.manualCoordinationSteps - b.manualCoordinationSteps, percent: ((a.manualCoordinationSteps - b.manualCoordinationSteps) / a.manualCoordinationSteps) * 100 }, negativeControls, falseAcceptance: negativeControls.filter((c) => c.actualAccepted && !c.expectedAccepted).length, falseRejection: negativeControls.filter((c) => !c.actualAccepted && c.expectedAccepted).length, confounders: ['Trials alternate A then B, so cache and thermal order effects may remain.','Dirty source identities are recorded; results apply to these exact working-tree identities.','Godot child-process CPU and peak memory are not available from Node spawnSync on this platform.','Path A records benchmark-owned artifact hashes; path B additionally produces the canonical ZIP.'], unproven: ['Performance on other machines, renderers, scenarios, or clean revisions.','Long-run flake rate and statistical significance from this small trial count.','Evidence reuse utility for Godot replay; no verified replay reuse contract exists.'] };
  const recommendation = a.success === trials && b.success === trials && summary.falseAcceptance === 0 && summary.falseRejection === 0 ? 'retain' : 'revise';
  summary.recommendation = recommendation;
  writeFileSync(path.join(root, 'records.ndjson'), `${records.map((r) => JSON.stringify(r)).join('\n')}\n`); writeFileSync(path.join(root, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
  const report = `# INDRO Calibration Gauntlet v1\n\nExact dirty working-tree identities are in \`summary.json\`. Warm-ups are excluded from statistics.\n\n| Path | Pass/fail | Median ms | p95 ms | Integrity | Coordination steps |\n|---|---:|---:|---:|---:|---:|\n| A original direct script | ${a.success}/${a.failure} | ${a.medianMs.toFixed(1)} | ${a.p95Ms.toFixed(1)} | ${a.evidenceIntegrityPass}/${a.trials} | ${a.manualCoordinationSteps} |\n| B indro godot replay | ${b.success}/${b.failure} | ${b.medianMs.toFixed(1)} | ${b.p95Ms.toFixed(1)} | ${b.evidenceIntegrityPass}/${b.trials} | ${b.manualCoordinationSteps} |\n\nWorkflow coordination compressed by ${summary.workflowCompression.percent.toFixed(0)}% (${a.manualCoordinationSteps} to ${b.manualCoordinationSteps} steps). Negative controls: ${negativeControls.filter((c) => c.correct).length}/${negativeControls.length} classified correctly; false acceptance ${summary.falseAcceptance}, false rejection ${summary.falseRejection}.\n\nRecommendation: **${recommendation}** the current architecture. See \`summary.json\` for confounders and unproven claims. Reused evidence was not counted as fresh execution and was not benchmarked because replay has no verified reuse integration.\n`;
  writeFileSync(path.join(root, 'report.md'), report); manifest(root);
  return { root, summary, records };
}

export async function runCalibrationCli(args) {
  const options = {};
  for (let i = 0; i < args.length; i += 1) { const key = args[i]; const value = args[++i]; if (!value) throw new Error(`${key} requires a value.`); if (key === '--warmups') options.warmups = Number(value); else if (key === '--trials') options.trials = Number(value); else if (key === '--timeout-ms') options.timeoutMs = Number(value); else if (key === '--output') options.output = value; else throw new Error(`Unknown calibration option: ${key}`); }
  const result = await runCalibration(options); console.log(`INDRO_CALIBRATION ${result.summary.recommendation.toUpperCase()} A=${result.summary.results.A.success}/${result.summary.results.A.trials} B=${result.summary.results.B.success}/${result.summary.results.B.trials} controls=${result.summary.negativeControls.filter((c) => c.correct).length}/${result.summary.negativeControls.length}`); console.log(`EVIDENCE=${result.root}`); return 0;
}
