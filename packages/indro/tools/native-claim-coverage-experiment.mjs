import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

const receiptPath = path.resolve(process.argv[2] || '');
const trials = Number(process.argv[3] || 1000);
if (!receiptPath || !existsSync(receiptPath) || !Number.isInteger(trials) || trials < 1) {
  console.error('Usage: node native-claim-coverage-experiment.mjs <native-receipt.json> [trials]');
  process.exit(2);
}
const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const original = JSON.parse(readFileSync(receiptPath, 'utf8'));
function resign(value, snapshotChanged = false) {
  const result = structuredClone(value);
  if (snapshotChanged) result.snapshot.fingerprint = digest(result.snapshot.inputs);
  const { integrity, ...body } = result;
  result.integrity = digest(body);
  return result;
}
const failed = structuredClone(original);
failed.exitCode = 1;
failed.status = 'FAIL';
const noRuntime = structuredClone(original);
noRuntime.snapshot.inputs.runtime = [];
const variants = {
  valid: original,
  corrupt_integrity: { ...original, integrity: '0'.repeat(64) },
  failed_execution: resign(failed),
  omitted_runtime: resign(noRuntime, true),
};
const validators = {
  provenance(value) {
    const { integrity, ...body } = value;
    return integrity === digest(body) && value.snapshot?.fingerprint === digest(value.snapshot?.inputs);
  },
  behavior(value) {
    return value.status === 'PASS' && value.exitCode === 0 && value.snapshot?.testCount > 0
      && value.command?.[0] === 'ctest';
  },
  runtime_closure(value) {
    return value.reusable === true && value.snapshot?.complete === true
      && Array.isArray(value.snapshot?.inputs?.runtime) && value.snapshot.inputs.runtime.length > 0;
  },
};
validators.full = (value) => Object.entries(validators).filter(([name]) => name !== 'full').every(([, validate]) => validate(value));
function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}
const results = {};
for (const [variant, value] of Object.entries(variants)) {
  results[variant] = {};
  for (const [claim, validate] of Object.entries(validators)) {
    const samples = [];
    let verdict = false;
    for (let index = 0; index < trials; index += 1) {
      const started = performance.now();
      verdict = validate(value);
      samples.push(performance.now() - started);
    }
    results[variant][claim] = { verdict, medianMs: median(samples) };
  }
}
console.log(JSON.stringify({
  schema: 'indro.native-claim-coverage-experiment/v1', receipt: receiptPath, trials, results,
  limits: [
    'Receipt validation does not establish applicability to current source or runtime state.',
    'The experiment isolates proof-fragment coverage; verifyNative remains the current-state authority.',
  ],
}, null, 2));
