import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { classifyRunEvidenceIntegrity, listRuns, runCommand } from './core.mjs';

export const REUSABLE_EVIDENCE_SCHEMA = 'commandhud.reusable-command-evidence/v1';

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function normalizedDefinition(definition) {
  if (!definition || typeof definition !== 'object') throw new Error('Reusable verification requires a definition.');
  if (!/^[a-z0-9][a-z0-9._/-]*$/i.test(definition.identity || '')) throw new Error('Reusable verification requires a stable command identity.');
  if (!Array.isArray(definition.argv) || !definition.argv.length || definition.argv.some((value) => typeof value !== 'string')) {
    throw new Error('Reusable verification requires a non-empty string argv.');
  }
  for (const field of ['inputs', 'dependencies', 'environment']) {
    if (!definition[field] || typeof definition[field] !== 'object' || Array.isArray(definition[field])) {
      throw new Error(`Reusable verification requires an explicit ${field} object.`);
    }
  }
  return {
    identity: definition.identity,
    argv: [...definition.argv],
    inputs: structuredClone(definition.inputs),
    dependencies: structuredClone(definition.dependencies),
    environment: structuredClone(definition.environment),
  };
}

export function reusableCommandFingerprint(definition) {
  return sha256(canonical({ schema: REUSABLE_EVIDENCE_SCHEMA, definition: normalizedDefinition(definition) }));
}

function evidenceIdentity(record, descriptor) {
  return sha256(canonical({
    schema: REUSABLE_EVIDENCE_SCHEMA,
    runId: record.id,
    descriptor,
    exitCode: record.exitCode,
    stdout: record.evidence?.stdout || null,
    stderr: record.evidence?.stderr || null,
  }));
}

export function validateReusableCommandEvidence(project, record, expectedDefinition) {
  const expected = normalizedDefinition(expectedDefinition);
  const expectedFingerprint = reusableCommandFingerprint(expected);
  const reasons = [];
  const retained = record?.operation?.reusableEvidence;
  let integrity = 'MISSING';
  if (!record) reasons.push('MISSING_EVIDENCE');
  else {
    try { integrity = classifyRunEvidenceIntegrity(project, record); }
    catch { integrity = 'CORRUPT'; }
    if (record.status !== 'pass' || record.exitCode !== 0 || record.operation?.status !== 'pass') reasons.push('FAILED_EVIDENCE');
    if (integrity === 'MISSING') reasons.push('MISSING_RAW_EVIDENCE');
    else if (integrity !== 'VERIFIED') reasons.push('TAMPERED_EVIDENCE');
    if (!retained || retained.schema !== REUSABLE_EVIDENCE_SCHEMA) reasons.push('MISSING_REUSE_IDENTITY');
    else {
      if (retained.fingerprint !== expectedFingerprint) reasons.push('MISMATCHED_EVIDENCE');
      if (canonical(retained.descriptor) !== canonical(expected)) reasons.push('MISMATCHED_DESCRIPTOR');
      const calculatedIdentity = evidenceIdentity(record, retained.descriptor);
      if (retained.evidenceIdentity !== calculatedIdentity) reasons.push('TAMPERED_EVIDENCE_IDENTITY');
    }
  }
  return {
    valid: reasons.length === 0,
    reasons: [...new Set(reasons)],
    integrity,
    runId: record?.id || null,
    evidenceIdentity: retained?.evidenceIdentity || null,
    expectedFingerprint,
  };
}

export async function executeReusableVerification(project, definition, options = {}) {
  const descriptor = normalizedDefinition(definition);
  const started = process.hrtime.bigint();
  let validationNs = 0n;
  let rejected = null;
  for (const record of listRuns(project, options.searchLimit || 1000)) {
    if (record?.operation?.type !== 'reusable-verification' || record.operation.identity !== descriptor.identity) continue;
    const tick = process.hrtime.bigint();
    const validation = validateReusableCommandEvidence(project, record, descriptor);
    validationNs += process.hrtime.bigint() - tick;
    if (validation.valid) {
      return {
        executed: false, skipped: true, record, validation,
        timing: { validationNs: Number(validationNs), executionNs: 0, totalNs: Number(process.hrtime.bigint() - started) },
      };
    }
    rejected ||= validation;
  }
  const executionStarted = process.hrtime.bigint();
  const record = await runCommand(project, descriptor.argv, {
    stream: options.stream || false,
    shell: false,
    captureDelta: false,
    requiredOutput: options.requiredOutput || 'stdout',
    objective: options.objective || `Verify ${descriptor.identity}`,
    request: `reusable verification ${descriptor.identity}`,
    origin: options.origin || 'core-api',
    operationIdentity: { type: 'reusable-verification', identity: descriptor.identity },
    operationReducer: ({ record: completed }) => {
      const fingerprint = reusableCommandFingerprint(descriptor);
      return {
        type: 'reusable-verification', identity: descriptor.identity,
        command: completed.command, status: completed.status, exitCode: completed.exitCode,
        reusableEvidence: {
          schema: REUSABLE_EVIDENCE_SCHEMA, descriptor, fingerprint,
          evidenceIdentity: evidenceIdentity(completed, descriptor),
        },
      };
    },
  });
  const executionNs = process.hrtime.bigint() - executionStarted;
  const tick = process.hrtime.bigint();
  const validation = validateReusableCommandEvidence(project, record, descriptor);
  validationNs += process.hrtime.bigint() - tick;
  return {
    executed: true, skipped: false, record, validation, rejected,
    timing: { validationNs: Number(validationNs), executionNs: Number(executionNs), totalNs: Number(process.hrtime.bigint() - started) },
  };
}

export function readRetainedOutput(record, stream = 'stdout') {
  return readFileSync(record[`${stream}Path`], 'utf8');
}
