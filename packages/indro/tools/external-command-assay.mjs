#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { classifyRunEvidenceIntegrity, listRuns, resolveProject } from '../../commandhud/core.mjs';

const sha256 = value => createHash('sha256').update(value).digest('hex');
const median = values => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

function git(root, ...args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr.trim()}`);
  return result.stdout.replaceAll('\r\n', '\n').trimEnd();
}

function parse(argv) {
  const marker = argv.indexOf('--');
  if (marker < 0 || marker === argv.length - 1) throw new Error('Usage: external-command-assay --root DIR --output FILE --name NAME --type TYPE [--trials N] -- COMMAND [ARG ...]');
  const flags = new Map();
  for (let index = 0; index < marker; index += 2) {
    const flag = argv[index], value = argv[index + 1];
    if (!['--root', '--output', '--name', '--type', '--trials'].includes(flag) || !value) throw new Error(`Invalid assay argument: ${flag || '(missing)'}`);
    if (flags.has(flag)) throw new Error(`Duplicate assay argument: ${flag}`);
    flags.set(flag, value);
  }
  for (const required of ['--root', '--output', '--name', '--type']) if (!flags.has(required)) throw new Error(`Missing assay argument: ${required}`);
  const trials = Number(flags.get('--trials') || 2);
  if (!Number.isInteger(trials) || trials < 1 || trials > 10) throw new Error('--trials must be an integer from 1 to 10');
  return { root: resolve(flags.get('--root')), output: resolve(flags.get('--output')), name: flags.get('--name'), type: flags.get('--type'), trials, command: argv.slice(marker + 1) };
}

function execute(command, root, env) {
  const started = performance.now();
  const result = spawnSync(command[0], command.slice(1), { cwd: root, env, encoding: 'utf8', windowsHide: true, shell: false, maxBuffer: 64 * 1024 * 1024 });
  return {
    elapsedMs: performance.now() - started,
    exitCode: result.status,
    error: result.error?.message || null,
    stdoutBytes: Buffer.byteLength(result.stdout || ''),
    stderrBytes: Buffer.byteLength(result.stderr || ''),
    stdoutSha256: sha256(result.stdout || ''),
    stderrSha256: sha256(result.stderr || ''),
  };
}

export async function runAssay(options) {
  const requestedRoot = realpathSync(resolve(options.root)), output = resolve(options.output);
  if (git(requestedRoot, 'rev-parse', '--show-prefix') !== '') throw new Error(`Assay root is not the Git root: ${requestedRoot}`);
  const root = realpathSync(resolve(git(requestedRoot, 'rev-parse', '--show-toplevel')));
  if (!relative(root, output).startsWith('..')) throw new Error('Assay output must remain outside the tested repository');
  const head = git(root, 'rev-parse', 'HEAD');
  const statusBefore = git(root, 'status', '--porcelain=v2', '--branch');
  const stateRoot = resolve(dirname(output), 'commandhud-state');
  const env = { ...process.env, HUD_STATE_ROOT: stateRoot };
  const cli = resolve(import.meta.dirname, '..', 'cli.mjs');
  const objective = `Verify ${options.name} ${options.type} tests`;
  const directCommand = options.command;
  const indroCommand = [process.execPath, cli, 'run', '--objective', objective, '--', ...directCommand];
  const project = await resolveProject({ root, env });
  const observations = [];
  const order = [];
  for (let index = 0; index < options.trials; index++) order.push(index % 2 ? 'indro' : 'direct');
  for (let index = options.trials - 1; index >= 0; index--) order.push(index % 2 ? 'direct' : 'indro');
  for (const mode of order) {
    const execution = execute(mode === 'direct' ? directCommand : indroCommand, root, env);
    const observation = { mode, ...execution };
    if (mode === 'indro') {
      const record = listRuns(project, 1)[0];
      observation.runId = record?.id || null;
      observation.recordedStatus = record?.status || null;
      observation.recordedExitCode = record?.exitCode ?? null;
      observation.integrity = classifyRunEvidenceIntegrity(project, record);
      observation.recordedDurationMs = record?.durationMs ?? null;
      observation.evidenceBytes = (record?.evidence?.stdout?.bytes || 0) + (record?.evidence?.stderr?.bytes || 0);
    }
    observations.push(observation);
  }

  const negative = execute([process.execPath, cli, 'run', '--objective', `Reject ${options.name} failing command`, '--', process.execPath, '-e', 'process.exit(7)'], root, env);
  const negativeRecord = listRuns(project, 1)[0];
  const statusAfter = git(root, 'status', '--porcelain=v2', '--branch');
  const direct = observations.filter(value => value.mode === 'direct');
  const indro = observations.filter(value => value.mode === 'indro');
  const directMedianMs = median(direct.map(value => value.elapsedMs));
  const indroMedianMs = median(indro.map(value => value.elapsedMs));
  const report = {
    schema: 'indro.external-command-assay/v2',
    generatedAt: new Date().toISOString(),
    repository: { name: options.name, type: options.type, root, head, origin: git(root, 'remote', 'get-url', 'origin') },
    command: directCommand,
    objective,
    environment: { platform: process.platform, arch: process.arch, node: process.version, runner: process.env.RUNNER_IMAGE || null, toolchain: process.env.INDRO_ASSAY_TOOLCHAIN || null },
    trialsPerMode: options.trials,
    order,
    observations,
    negativeControl: {
      outerExitCode: negative.exitCode,
      recordedExitCode: negativeRecord?.exitCode ?? null,
      recordedStatus: negativeRecord?.status || null,
      integrity: classifyRunEvidenceIntegrity(project, negativeRecord),
    },
    worktree: { unchanged: statusBefore === statusAfter, beforeSha256: sha256(statusBefore), afterSha256: sha256(statusAfter) },
    measurements: {
      directMedianMs,
      indroMedianMs,
      overheadMs: indroMedianMs - directMedianMs,
      overheadRatio: directMedianMs ? indroMedianMs / directMedianMs : null,
      observedIndroMedianLower: indroMedianMs < directMedianMs,
      retainedEvidenceBytes: indro.reduce((sum, value) => sum + value.evidenceBytes, 0),
    },
    claims: {
      behaviorPreserved: [...direct, ...indro].every(value => value.exitCode === 0) && indro.every(value => value.recordedExitCode === 0 && value.recordedStatus === 'pass' && value.integrity === 'VERIFIED'),
      failurePreserved: negative.exitCode === 1 && negativeRecord?.exitCode === 7 && negativeRecord?.status === 'fail' && classifyRunEvidenceIntegrity(project, negativeRecord) === 'VERIFIED',
      firstExecutionAccelerationSupported: false,
      resultReuseMeasured: false,
    },
    limitations: [
      'Exit behavior and evidence integrity are compared; repository-specific semantic assertions remain owned by each test command.',
      'Recorded execution does not reuse test results, so any speedup would be incidental and is not an INDRO caching claim.',
      'Process startup, filesystem caches, scheduler noise, and interleaving order remain part of the end-to-end measurement.',
      'Direct execution runs first, so a lower INDRO median cannot establish acceleration; compiler and test caches are a known confounder.',
    ],
  };
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
  const bytes = readFileSync(output);
  if (!report.claims.behaviorPreserved || !report.claims.failurePreserved || !report.worktree.unchanged) {
    throw new Error(`Assay correctness failed; diagnostic receipt retained at ${output}: ${JSON.stringify({ claims: report.claims, worktree: report.worktree })}`);
  }
  return { report, output, bytes: statSync(output).size, sha256: sha256(bytes) };
}

async function main() {
  const options = parse(process.argv.slice(2));
  const result = await runAssay(options);
  console.log(`INDRO_EXTERNAL_ASSAY PASS name=${options.name} direct_ms=${result.report.measurements.directMedianMs.toFixed(1)} indro_ms=${result.report.measurements.indroMedianMs.toFixed(1)} causal_acceleration=0`);
  console.log(`EVIDENCE=${result.output} SHA256=${result.sha256}`);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) main().catch(error => { console.error(`INDRO_EXTERNAL_ASSAY FAIL ${error.message}`); process.exitCode = 1; });
