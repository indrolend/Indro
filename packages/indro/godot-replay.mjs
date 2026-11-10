import { createHash, randomUUID } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { executeReusableVerification, readRetainedOutput } from '../commandhud/evidence-reuse.mjs';
import { listRuns, resolveProject } from '../commandhud/core.mjs';

export const PROTOCOL_SCHEMA = 4;
export const SCENARIOS = Object.freeze({ smoke: 'observe\nstep frames=1\nassert room=1\n' });
export const GODOT_REPLAY_OBJECTIVE = 'Verify the current Godot gameplay replay.';

const here = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(here, '..', '..');

function sha256File(file) {
  const hash = createHash('sha256');
  hash.update(readFileSync(file));
  return hash.digest('hex');
}

function command(executable, args, cwd) {
  return execFileSync(executable, args, { cwd, encoding: 'utf8', windowsHide: true }).trim();
}

function parseArgs(args) {
  if (args[0] !== 'replay') throw new Error('Usage: indro godot replay --scenario smoke [--commands FILE] [--capture] [--clipboard] [--clipboard-image] [--video]');
  const options = { scenario: null, commands: null, capture: false, clipboard: false, clipboardImage: false, video: false };
  for (let index = 1; index < args.length; index += 1) {
    const value = args[index];
    if (value === '--scenario' || value === '--commands') {
      if (!args[index + 1]) throw new Error(`${value} requires a value.`);
      options[value.slice(2)] = args[++index];
    } else if (value === '--capture') options.capture = true;
    else if (value === '--clipboard') options.clipboard = true;
    else if (value === '--clipboard-image') options.clipboardImage = true;
    else if (value === '--video') options.video = true;
    else throw new Error(`Unknown Godot replay option: ${value}`);
  }
  if (options.scenario && options.commands) throw new Error('--scenario and --commands are mutually exclusive.');
  if (!options.scenario && !options.commands) throw new Error('Godot replay requires --scenario or --commands.');
  if (options.scenario && !SCENARIOS[options.scenario]) throw new Error(`Unknown Godot replay scenario: ${options.scenario}`);
  return options;
}

export function resolveExecutable(name, explicit) {
  if (explicit) {
    const resolved = path.resolve(explicit);
    if (!existsSync(resolved)) throw new Error(`${name} executable does not exist: ${resolved}`);
    return resolved;
  }
  try {
    const result = command(process.platform === 'win32' ? 'where.exe' : 'which', [name], process.cwd()).split(/\r?\n/)[0];
    if (result && existsSync(result)) return path.resolve(result);
  } catch {}
  throw new Error(`${name} executable is unavailable.`);
}

export function resolveGodotProject(explicit = process.env.INDRO_GODOT_PROJECT) {
  const candidates = explicit ? [explicit] : [
    path.join(os.homedir(), 'Projects', 'data-game', 'godot'),
    path.join(os.homedir(), 'Projects', 'DigitalBreakdown-Godot-Migration', 'godot'),
  ];
  for (const candidate of candidates) {
    const resolved = path.resolve(candidate);
    if (existsSync(path.join(resolved, 'project.godot')) && existsSync(path.join(resolved, 'scripts', 'agent_playtest.gd'))) return resolved;
  }
  throw new Error('Godot project with scripts/agent_playtest.gd is unavailable; set INDRO_GODOT_PROJECT.');
}

function parseFields(line) {
  const fields = {};
  const expression = /([a-zA-Z_][\w-]*)=("[^"]*"|\S+)/g;
  for (const match of line.matchAll(expression)) fields[match[1]] = match[2].replace(/^"|"$/g, '');
  return fields;
}

export function validateReplay({ stdout, stderr = '', exitCode, captureDir, commandsText, requireCapture = true }) {
  const errors = [];
  const readyLines = stdout.split(/\r?\n/).filter((line) => line.startsWith('AGENT_PLAYTEST_READY '));
  const stateLines = stdout.split(/\r?\n/).filter((line) => line.startsWith('AGENT_STATE '));
  const assertionLines = stdout.split(/\r?\n/).filter((line) => line.startsWith('AGENT_ASSERT_PASS '));
  const eofLines = stdout.split(/\r?\n/).filter((line) => line.startsWith('AGENT_PLAYTEST_EOF '));
  const protocolErrors = stdout.split(/\r?\n/).filter((line) => line.includes('AGENT_PLAYTEST_ERROR'));
  if (exitCode !== 0) errors.push(`EXIT_CODE_${exitCode}`);
  if (readyLines.length !== 1 || Number(parseFields(readyLines[0] || '').schema) !== PROTOCOL_SCHEMA) errors.push('MISSING_OR_INVALID_READY');
  if (!stateLines.length) errors.push('MISSING_OBSERVATIONS');
  if (eofLines.length !== 1) errors.push('MISSING_SUCCESSFUL_TERMINATION');
  if (protocolErrors.length) errors.push('PROTOCOL_ERROR');
  const observations = stateLines.map((line) => ({ ...parseFields(line), raw: line }));
  const frames = observations.map((row) => Number(row.frame));
  if (frames.some((frame) => !Number.isInteger(frame)) || frames.some((frame, index) => index && frame < frames[index - 1])) errors.push('INVALID_SIMULATION_PROGRESSION');
  const requestedSteps = [...commandsText.matchAll(/^step(?:\s+.*?frames=(\d+))?/gm)].reduce((sum, match) => sum + Number(match[1] || 1), 0);
  if (requestedSteps && frames.length && frames.at(-1) - frames[0] !== requestedSteps) errors.push('INVALID_SIMULATION_PROGRESSION');
  const expectedAssertions = (commandsText.match(/^assert\s+/gm) || []).length;
  if (assertionLines.length !== expectedAssertions) errors.push('ASSERTION_RESULTS_INCOMPLETE');
  const captures = existsSync(captureDir) ? readdirSync(captureDir).filter((name) => name.toLowerCase().endsWith('.png')).sort() : [];
  if (requireCapture && captures.length !== observations.length) errors.push('CAPTURE_COUNT_MISMATCH');
  for (const [index, row] of observations.entries()) {
    if (requireCapture && (row.frame_capture !== '1' || !captures[index])) errors.push('CAPTURE_RECORD_INVALID');
    if (requireCapture && captures[index]) {
      const file = path.join(captureDir, captures[index]);
      const bytes = readFileSync(file);
      if (bytes.length < 24 || bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') errors.push('CAPTURE_FILE_INVALID');
    }
  }
  return { valid: errors.length === 0, errors: [...new Set(errors)], observations, assertions: assertionLines.map((raw) => ({ ...parseFields(raw), raw })), captures, protocolErrors, stderrBytes: Buffer.byteLength(stderr) };
}

function gitIdentity(root) {
  const top = command('git', ['rev-parse', '--show-toplevel'], root);
  const status = command('git', ['status', '--porcelain=v1', '--untracked-files=all'], root);
  return {
    root: top, branch: command('git', ['branch', '--show-current'], root), commit: command('git', ['rev-parse', 'HEAD'], root),
    origin: (() => { try { return command('git', ['remote', 'get-url', 'origin'], root); } catch { return null; } })(),
    dirty: Boolean(status), statusSha256: createHash('sha256').update(status).digest('hex'), status,
  };
}

function runtimeGitIdentity(root, scope = root) {
  const identity = gitIdentity(root);
  const relativeScope = path.relative(root, scope).replaceAll('\\', '/') || '.';
  const tracked = command('git', ['diff', '--binary', 'HEAD', '--', relativeScope], root);
  const untracked = command('git', ['ls-files', '--others', '--exclude-standard', '-z', '--', relativeScope], root)
    .split('\0').filter(Boolean).sort().map((name) => ({ name, sha256: sha256File(path.join(root, name)) }));
  return { ...identity, worktreeSha256: createHash('sha256').update(JSON.stringify({ tracked, untracked })).digest('hex') };
}

function writeManifest(directory, excluded = new Set()) {
  const files = [];
  function walk(current) {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      const relative = path.relative(directory, full).replaceAll('\\', '/');
      if (excluded.has(relative)) continue;
      if (entry.isDirectory()) walk(full);
      else files.push({ path: relative, bytes: statSync(full).size, sha256: sha256File(full) });
    }
  }
  walk(directory);
  files.sort((a, b) => a.path.localeCompare(b.path));
  writeFileSync(path.join(directory, 'sha256-manifest.json'), `${JSON.stringify({ schema: 'indro.godot-replay-artifacts/v1', files }, null, 2)}\n`);
  return files;
}

function verifyManifest(directory) {
  const reasons = [];
  try {
    const manifest = JSON.parse(readFileSync(path.join(directory, 'sha256-manifest.json'), 'utf8'));
    if (manifest.schema !== 'indro.godot-replay-artifacts/v1' || !Array.isArray(manifest.files)) return { valid: false, reasons: ['INVALID_ARTIFACT_MANIFEST'] };
    for (const entry of manifest.files) {
      const file = path.resolve(directory, entry.path);
      if (!file.startsWith(`${path.resolve(directory)}${path.sep}`) || !existsSync(file)) reasons.push('MISSING_CAPTURED_ARTIFACT');
      else if (statSync(file).size !== entry.bytes || sha256File(file) !== entry.sha256) reasons.push('CORRUPT_CAPTURED_ARTIFACT');
    }
  } catch { reasons.push('INVALID_ARTIFACT_MANIFEST'); }
  return { valid: reasons.length === 0, reasons: [...new Set(reasons)] };
}

const RESULT_PREFIX = 'INDRO_GODOT_REPLAY_RESULT=';

function retainedReplayResult(record) {
  const line = readRetainedOutput(record).split(/\r?\n/).find((value) => value.startsWith(RESULT_PREFIX));
  if (!line) throw new Error('Reusable replay evidence has no result descriptor.');
  return JSON.parse(line.slice(RESULT_PREFIX.length));
}

export function godotReplayClaims(objective) {
  const words = new Set(String(objective || '').toLowerCase().match(/[a-z0-9]+/g) || []);
  const claims = ['behavior'];
  const explicit = words.has('behavior') || words.has('visual') || words.has('appearance') || words.has('frame')
    || words.has('screenshot') || words.has('capture') || words.has('video') || words.has('continuity')
    || words.has('artifact') || words.has('integrity') || words.has('zip') || words.has('evidence');
  if (!explicit || ['visual', 'appearance', 'frame', 'screenshot', 'capture'].some((word) => words.has(word))) claims.push('visual');
  if (!explicit || ['artifact', 'integrity', 'zip', 'evidence'].some((word) => words.has(word))) claims.push('artifacts');
  if (words.has('video') || words.has('continuity')) claims.push('continuity');
  return claims;
}

export function validateReplayArtifacts(record, commandsText, claims = ['behavior', 'visual', 'artifacts']) {
  const reasons = [];
  let result = null;
  let validation = null;
  const selected = new Set(claims);
  const checked = [];
  try {
    result = retainedReplayResult(record);
    const directory = path.resolve(result.directory);
    if (selected.has('behavior') || selected.has('visual')) {
      checked.push('behavior');
      if (selected.has('visual')) checked.push('visual');
      const exitCode = Number(readFileSync(path.join(directory, 'exit-code.txt'), 'utf8').trim());
      validation = validateReplay({
        stdout: readFileSync(path.join(directory, 'stdout.log'), 'utf8'),
        stderr: readFileSync(path.join(directory, 'stderr.log'), 'utf8'),
        exitCode, captureDir: path.join(directory, 'captures'), commandsText, requireCapture: selected.has('visual'),
      });
      if (!validation.valid) reasons.push(...validation.errors.map((reason) => `REPLAY_${reason}`));
    }
    if (selected.has('artifacts')) {
      checked.push('artifacts');
      const zipPath = path.resolve(result.zipPath);
      reasons.push(...verifyManifest(directory).reasons);
      if (!existsSync(zipPath) || sha256File(zipPath) !== result.zipSha256) reasons.push('CORRUPT_EVIDENCE_ZIP');
    }
    if (selected.has('continuity')) {
      checked.push('continuity');
      if (!result.video || !existsSync(result.video)) reasons.push('MISSING_REPLAY_VIDEO');
      else {
        const probe = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', result.video], { encoding: 'utf8', windowsHide: true });
        if (probe.error || probe.status !== 0 || !(Number(probe.stdout.trim()) > 0)) reasons.push('INVALID_REPLAY_VIDEO_CONTINUITY');
      }
    }
  } catch { reasons.push('INVALID_REPLAY_ARTIFACTS'); }
  return { valid: reasons.length === 0, reasons: [...new Set(reasons)], result, validation, claims: [...selected], checked };
}

export function requireConfirmedClipboardResult(result) {
  if (result.error || result.status !== 0 || !String(result.stdout || '').includes('INDRO_CLIPBOARD_CONFIRMED')) {
    throw new Error(`Clipboard transfer failed: ${(result.stderr || result.stdout || result.error?.message || 'unconfirmed').trim()}`);
  }
}

function powershell(script, args) {
  const shell = resolveExecutable('powershell.exe', process.env.INDRO_POWERSHELL);
  const result = spawnSync(shell, ['-NoProfile', '-STA', '-Command', `& { ${script} }`, ...args], { encoding: 'utf8', windowsHide: true });
  requireConfirmedClipboardResult(result);
}

function copyFileDrop(file) {
  powershell("param($file); Add-Type -AssemblyName System.Windows.Forms; $p=[IO.Path]::GetFullPath($file); $c=New-Object Collections.Specialized.StringCollection; [void]$c.Add($p); [Windows.Forms.Clipboard]::SetFileDropList($c); $r=[Windows.Forms.Clipboard]::GetFileDropList(); if($r.Count -ne 1 -or [IO.Path]::GetFullPath($r[0]) -ne $p){exit 9}; 'INDRO_CLIPBOARD_CONFIRMED'", [file]);
}

function copyImage(file) {
  powershell("param($file); Add-Type -AssemblyName System.Windows.Forms; Add-Type -AssemblyName System.Drawing; $i=[Drawing.Image]::FromFile([IO.Path]::GetFullPath($file)); try {[Windows.Forms.Clipboard]::SetImage($i)} finally {$i.Dispose()}; if(-not [Windows.Forms.Clipboard]::ContainsImage()){exit 9}; 'INDRO_CLIPBOARD_CONFIRMED'", [file]);
}

function zipDirectory(directory, zipPath) {
  const script = "param($source,$destination); Add-Type -AssemblyName System.IO.Compression.FileSystem; [IO.Compression.ZipFile]::CreateFromDirectory([IO.Path]::GetFullPath($source),[IO.Path]::GetFullPath($destination),[IO.Compression.CompressionLevel]::Optimal,$false)";
  const shell = resolveExecutable('powershell.exe', process.env.INDRO_POWERSHELL);
  const result = spawnSync(shell, ['-NoProfile', '-Command', `& { ${script} }`, directory, zipPath], { encoding: 'utf8', windowsHide: true });
  if (result.error || result.status !== 0 || !existsSync(zipPath)) throw new Error(`Evidence ZIP creation failed: ${(result.stderr || result.error?.message || '').trim()}`);
}

async function executeFreshReplay(options, dependencies = {}) {
  const started = Date.now();
  const project = resolveGodotProject(dependencies.project);
  const sourceRoot = command('git', ['rev-parse', '--show-toplevel'], project);
  const godot = resolveExecutable('godot_console.exe', dependencies.godot || process.env.INDRO_GODOT_EXECUTABLE);
  const evidenceRoot = path.resolve(dependencies.evidenceRoot || process.env.INDRO_EVIDENCE_ROOT || path.join(repositoryRoot, 'evidence', 'godot-replay'));
  const runId = `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID()}`;
  const directory = path.join(evidenceRoot, runId);
  const capturesDir = path.join(directory, 'captures');
  mkdirSync(capturesDir, { recursive: true });
  const commandsText = options.commands ? readFileSync(path.resolve(options.commands), 'utf8') : SCENARIOS[options.scenario];
  if (!commandsText.trim()) throw new Error('Command file is empty.');
  const commandsPath = path.join(directory, 'commands.txt');
  writeFileSync(commandsPath, commandsText);
  const invocation = [
    '--path', project, '--resolution', '1280x720', '--rendering-method', 'gl_compatibility',
    '--script', 'res://scripts/agent_playtest.gd', '--', `--commands=${commandsPath.replaceAll('\\', '/')}`, `--capture-dir=${capturesDir.replaceAll('\\', '/')}`,
  ];
  const result = spawnSync(godot, invocation, { cwd: sourceRoot, encoding: 'utf8', windowsHide: false, timeout: dependencies.timeout || 120000, maxBuffer: 32 * 1024 * 1024 });
  const stdout = result.stdout || '';
  const stderr = `${result.stderr || ''}${result.error ? `${result.error.message}\n` : ''}`;
  const exitCode = result.status ?? 127;
  writeFileSync(path.join(directory, 'stdout.log'), stdout);
  writeFileSync(path.join(directory, 'stderr.log'), stderr);
  writeFileSync(path.join(directory, 'exit-code.txt'), `${exitCode}\n`);
  const validation = validateReplay({ stdout, stderr, exitCode, captureDir: capturesDir, commandsText, requireCapture: true });
  writeFileSync(path.join(directory, 'observations.json'), `${JSON.stringify(validation.observations, null, 2)}\n`);
  writeFileSync(path.join(directory, 'assertions.json'), `${JSON.stringify(validation.assertions, null, 2)}\n`);
  const executable = { path: godot, bytes: statSync(godot).size, sha256: sha256File(godot), version: stdout.split(/\r?\n/)[0] || null };
  const metadata = {
    schema: 'indro.godot-replay/v1', runId, scenario: options.scenario, startedAt: new Date(started).toISOString(), finishedAt: new Date().toISOString(), durationMs: Date.now() - started,
    source: gitIdentity(sourceRoot), indroSource: gitIdentity(repositoryRoot), runtime: executable, project, invocation: [godot, ...invocation], exitCode,
    requested: { capture: options.capture, clipboard: options.clipboard, clipboardImage: options.clipboardImage, video: options.video }, validation: { ...validation, observations: undefined, assertions: undefined },
  };
  writeFileSync(path.join(directory, 'metadata.json'), `${JSON.stringify(metadata, null, 2)}\n`);
  if (!validation.valid) {
    writeManifest(directory);
    const error = new Error(`Godot replay verification failed: ${validation.errors.join(', ')}`);
    error.evidenceDirectory = directory;
    throw error;
  }
  let video = null;
  if (options.video) {
    const ffmpeg = resolveExecutable('ffmpeg.exe', dependencies.ffmpeg || process.env.INDRO_FFMPEG_EXECUTABLE);
    video = path.join(directory, 'replay.mp4');
    const concatPath = path.join(directory, 'video-input.txt');
    const concat = validation.captures.map((name) => `file '${path.join(capturesDir, name).replaceAll('\\', '/').replaceAll("'", "'\\''")}'\nduration 0.5`).join('\n');
    writeFileSync(concatPath, `${concat}\nfile '${path.join(capturesDir, validation.captures.at(-1)).replaceAll('\\', '/')}'\n`);
    const videoResult = spawnSync(ffmpeg, ['-y', '-f', 'concat', '-safe', '0', '-i', concatPath, '-vf', 'pad=ceil(iw/2)*2:ceil(ih/2)*2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', video], { encoding: 'utf8', windowsHide: true });
    if (videoResult.error || videoResult.status !== 0 || !existsSync(video)) throw new Error(`Video generation failed: ${(videoResult.stderr || videoResult.error?.message || '').trim()}`);
  }
  writeManifest(directory);
  const zipPath = `${directory}.zip`;
  zipDirectory(directory, zipPath);
  if (options.clipboard) copyFileDrop(zipPath);
  if (options.clipboardImage) copyImage(path.join(capturesDir, validation.captures.at(-1)));
  return { directory, zipPath, video, durationMs: Date.now() - started, validation, metadata, zipSha256: sha256File(zipPath) };
}

export async function replay(options, dependencies = {}) {
  const project = resolveGodotProject(dependencies.project);
  const sourceRoot = command('git', ['rev-parse', '--show-toplevel'], project);
  const godot = resolveExecutable('godot_console.exe', dependencies.godot || process.env.INDRO_GODOT_EXECUTABLE);
  const evidenceRoot = path.resolve(dependencies.evidenceRoot || process.env.INDRO_EVIDENCE_ROOT || path.join(repositoryRoot, 'evidence', 'godot-replay'));
  const commandsText = options.commands ? readFileSync(path.resolve(options.commands), 'utf8') : SCENARIOS[options.scenario];
  if (!commandsText.trim()) throw new Error('Command file is empty.');
  const runtime = { path: godot, bytes: statSync(godot).size, sha256: sha256File(godot), version: command(godot, ['--version'], sourceRoot) };
  const payload = { options, dependencies: { project, godot, evidenceRoot, timeout: dependencies.timeout } };
  const requiredClaims = dependencies.requiredClaims || ['behavior', 'visual', 'artifacts'];
  const descriptor = {
    identity: 'indro/godot/replay',
    argv: [process.execPath, fileURLToPath(import.meta.url), '--execute-replay-worker', Buffer.from(JSON.stringify(payload)).toString('base64url')],
    inputs: { scenario: options.scenario, commandsSha256: createHash('sha256').update(commandsText).digest('hex') },
    dependencies: {
      source: runtimeGitIdentity(sourceRoot, project), runtime, protocolSchema: PROTOCOL_SCHEMA,
      indroFiles: ['godot-replay.mjs', '../commandhud/evidence-reuse.mjs', '../commandhud/core.mjs'].map((name) => ({ name, sha256: sha256File(path.resolve(here, name)) })),
    },
    environment: { platform: process.platform, arch: process.arch, node: process.version },
  };
  const hudProject = await resolveProject({ root: sourceRoot });
  const reusable = await executeReusableVerification(hudProject, descriptor, {
    requiredOutput: 'stdout', objective: 'Verify Godot replay', origin: 'core-api',
    validateEvidence: async ({ record }) => validateReplayArtifacts(record, commandsText, requiredClaims),
  });
  if (!reusable.validation.valid) throw new Error(`Godot replay reusable evidence failed: ${reusable.validation.reasons.join(', ')}`);
  const retained = reusable.validation.domain?.result || retainedReplayResult(reusable.record);
  const validation = reusable.validation.domain?.validation || validateReplayArtifacts(reusable.record, commandsText, requiredClaims).validation;
  return { ...retained, validation, claims: requiredClaims, checkedClaims: reusable.validation.domain?.checked || requiredClaims, metadata: JSON.parse(readFileSync(path.join(retained.directory, 'metadata.json'), 'utf8')), durationMs: reusable.timing.totalNs / 1e6, executed: reusable.executed, skipped: reusable.skipped, cacheDecision: reusable.executed ? (reusable.rejected ? 'rejected' : 'cold') : 'reused', cacheRejection: reusable.rejected?.reasons || [] };
}

export function recognizesGodotReplayObjective(objective) {
  const words = new Set(String(objective || '').toLowerCase().match(/[a-z0-9]+/g) || []);
  return words.has('godot') && words.has('replay') && (words.has('verify') || words.has('check'));
}

export function retainedReplayOptions(record) {
  const descriptor = record?.operation?.reusableEvidence?.descriptor;
  if (descriptor?.identity !== 'indro/godot/replay') return null;
  const marker = descriptor.argv?.indexOf('--execute-replay-worker');
  if (marker < 0 || !descriptor.argv[marker + 1]) return null;
  try {
    const payload = JSON.parse(Buffer.from(descriptor.argv[marker + 1], 'base64url').toString('utf8'));
    return payload?.options && typeof payload.options === 'object' ? structuredClone(payload.options) : null;
  } catch {
    return null;
  }
}

export async function runGodotReplayObjective(objective, dependencies = {}) {
  if (!recognizesGodotReplayObjective(objective)) throw new Error(`No verified workflow matches objective: ${objective}`);
  const projectRoot = (dependencies.resolveGodotProject || resolveGodotProject)(dependencies.project);
  const sourceRoot = command('git', ['rev-parse', '--show-toplevel'], projectRoot);
  const project = await (dependencies.resolveProject || resolveProject)({ root: sourceRoot });
  const records = (dependencies.listRuns || listRuns)(project, dependencies.searchLimit || 1000);
  const historical = records.find((record) => record?.status === 'pass' && record?.exitCode === 0 && retainedReplayOptions(record));
  if (!historical) throw new Error('No retained Godot replay workflow exists for the current repository. Run indro godot replay explicitly once.');
  const options = retainedReplayOptions(historical);
  const result = await (dependencies.replay || replay)(options, dependencies);
  return { objective, selectedRunId: historical.id, options, result };
}

export async function discoverGodotReplayWorkflow(objective, dependencies = {}) {
  if (!recognizesGodotReplayObjective(objective)) return null;
  let records = dependencies.records;
  if (!records) {
    const sourceRoot = dependencies.projectRoot || command('git', ['rev-parse', '--show-toplevel'], (dependencies.resolveGodotProject || resolveGodotProject)(dependencies.project));
    const project = await (dependencies.resolveProject || resolveProject)({ root: sourceRoot });
    records = (dependencies.listRuns || listRuns)(project, dependencies.searchLimit || 1000);
  }
  const historical = records.find((record) => record?.status === 'pass' && record?.exitCode === 0 && retainedReplayOptions(record));
  if (!historical) return null;
  const options = retainedReplayOptions(historical);
  const claims = godotReplayClaims(objective);
  if (claims.includes('continuity') && !options.video) options.video = true;
  return {
    id: 'indro/godot/replay', evidenceId: historical.id, confidence: 100,
    expectedCostMs: Number.isFinite(historical.durationMs) ? historical.durationMs : Number.POSITIVE_INFINITY,
    execute: () => (dependencies.replay || replay)(options, { ...dependencies, requiredClaims: claims }),
    render: printReplayResult,
  };
}

export function printReplayResult(result) {
  console.log(`INDRO_GODOT_REPLAY PASS claims=${(result.claims || []).join(',')} observations=${result.validation.observations.length} assertions=${result.validation.assertions.length} captures=${result.validation.captures.length} duration_ms=${result.durationMs} executed=${result.executed ? 1 : 0} cache=${result.cacheDecision}`);
  if (result.cacheRejection?.length) console.log(`CACHE_REJECTION=${result.cacheRejection.join(',')}`);
  console.log(`EVIDENCE=${result.directory}`);
  console.log(`ZIP=${result.zipPath}`);
  console.log(`ZIP_SHA256=${result.zipSha256}`);
  if (result.video) console.log(`VIDEO=${result.video}`);
}

export async function runGodotObjectiveCli(objective) {
  try {
    const resolution = await runGodotReplayObjective(objective);
    console.log(`INDRO_OBJECTIVE PASS workflow=indro/godot/replay selected_run=${resolution.selectedRunId}`);
    printReplayResult(resolution.result);
    return 0;
  } catch (error) {
    console.error(`INDRO_OBJECTIVE FAIL ${error.message}`);
    return 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) && process.argv[2] === '--execute-replay-worker') {
  const payload = JSON.parse(Buffer.from(process.argv[3], 'base64url').toString('utf8'));
  executeFreshReplay(payload.options, payload.dependencies).then((result) => {
    console.log(`${RESULT_PREFIX}${JSON.stringify({ directory: result.directory, zipPath: result.zipPath, video: result.video, zipSha256: result.zipSha256 })}`);
  }).catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
}

export async function runGodotCli(args) {
  try {
    if (args[0] === 'benchmark') {
      const { runCalibrationCli } = await import('./calibration-gauntlet.mjs');
      return await runCalibrationCli(args.slice(1));
    }
    const options = parseArgs(args);
    const result = await replay(options);
    printReplayResult(result);
    if (options.clipboard) console.log('CLIPBOARD=file-drop-confirmed');
    if (options.clipboardImage) console.log('CLIPBOARD_IMAGE=image-confirmed');
    return 0;
  } catch (error) {
    console.error(`INDRO_GODOT_REPLAY FAIL ${error.message}`);
    if (error.evidenceDirectory) console.error(`EVIDENCE=${error.evidenceDirectory}`);
    return 1;
  }
}
