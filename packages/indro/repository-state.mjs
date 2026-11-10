import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readRetainedOutput, executeReusableVerification } from '../commandhud/evidence-reuse.mjs';
import { resolveProject } from '../commandhud/core.mjs';

const IDENTITY = 'indro/repository/state';

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function status(root) {
  const result = spawnSync('git', ['status', '--porcelain=v2', '--branch'], {
    cwd: root, encoding: 'utf8', windowsHide: true, shell: false,
  });
  if (result.error || result.status !== 0) throw new Error(`Unable to acquire Git state: ${result.error?.message || result.stderr.trim()}`);
  const output = result.stdout.replaceAll('\r\n', '\n');
  const head = output.match(/^# branch\.oid (.+)$/m)?.[1];
  if (!head || head === '(initial)') throw new Error('Repository state verification requires a committed HEAD.');
  const branch = output.match(/^# branch\.head (.+)$/m)?.[1] || '(detached)';
  const changed = output.split('\n').filter((line) => line && !line.startsWith('# '));
  return { output, head, branch, dirty: changed.length > 0, changed: changed.length, sha256: sha256(output) };
}

function descriptor(project, observed) {
  return {
    identity: IDENTITY,
    argv: ['git', 'status', '--porcelain=v2', '--branch'],
    inputs: { claim: 'current Git HEAD, branch, and worktree state' },
    dependencies: { repository: project.identity.id, statusSha256: observed.sha256 },
    environment: { platform: process.platform, arch: process.arch },
  };
}

function validateOutput(record, expected) {
  try {
    const output = readRetainedOutput(record).replaceAll('\r\n', '\n');
    return sha256(output) === expected.sha256
      ? { valid: true, state: expected }
      : { valid: false, reasons: ['REPOSITORY_STATE_OUTPUT_MISMATCH'] };
  } catch {
    return { valid: false, reasons: ['REPOSITORY_STATE_OUTPUT_MISSING'] };
  }
}

export function recognizesRepositoryStateObjective(objective) {
  const words = new Set(String(objective || '').toLowerCase().match(/[a-z0-9]+/g) || []);
  return words.has('repository') && (words.has('state') || words.has('status')) && (words.has('verify') || words.has('check'));
}

export async function verifyRepositoryState(root, dependencies = {}) {
  const project = dependencies.project || await (dependencies.resolveProject || resolveProject)({ root });
  const observed = (dependencies.status || status)(project.root);
  const reusable = await (dependencies.executeReusableVerification || executeReusableVerification)(project, descriptor(project, observed), {
    objective: 'Verify current repository state', requiredOutput: 'stdout', origin: 'core-api',
    validateEvidence: async ({ record }) => validateOutput(record, observed),
  });
  if (!reusable.validation.valid) throw new Error(`Repository state evidence failed: ${reusable.validation.reasons.join(', ')}`);
  return {
    ...observed, executed: reusable.executed, skipped: reusable.skipped,
    reuseDecision: reusable.executed ? (reusable.rejected ? 'invalidated' : 'cold') : 'reused',
    evidenceId: reusable.record.id, validationMs: reusable.timing.validationNs / 1e6,
    elapsedMs: reusable.timing.totalNs / 1e6,
  };
}

export function discoverRepositoryStateWorkflow(objective, { projectRoot, project, records = [], ...dependencies } = {}) {
  if (!recognizesRepositoryStateObjective(objective)) return null;
  const historical = records.find((record) => record?.status === 'pass' && record?.exitCode === 0
    && record?.operation?.reusableEvidence?.descriptor?.identity === IDENTITY);
  return {
    id: IDENTITY, evidenceId: historical?.id || 'none', confidence: 100,
    expectedCostMs: Number.isFinite(historical?.durationMs) ? historical.durationMs : Number.POSITIVE_INFINITY,
    execute: () => verifyRepositoryState(projectRoot, { ...dependencies, project }),
    render(result) {
      console.log(`INDRO_REPOSITORY_STATE PASS head=${result.head} branch=${result.branch} dirty=${result.dirty ? 1 : 0} changed=${result.changed} elapsed_ms=${result.elapsedMs.toFixed(1)} reuse=${result.reuseDecision}`);
      console.log(`EVIDENCE=${result.evidenceId}`);
    },
  };
}
