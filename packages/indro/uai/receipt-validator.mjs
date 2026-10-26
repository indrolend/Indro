import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

export function validateReceipt(path, expectedHash, options = {}) {
  const result = {
    integrity: 'UNKNOWN',
    consistency: 'UNKNOWN',
    provenance: 'UNKNOWN',
    freshness: 'UNKNOWN',
    reusable: false,
    issues: []
  };
  const fail = issue => result.issues.push(issue);
  let bytes, receipt;
  try {
    bytes = readFileSync(path);
    receipt = JSON.parse(bytes.toString('utf8'));
  } catch {
    fail('UNREADABLE_RECEIPT');
    return result;
  }
  const hash = createHash('sha256').update(bytes).digest('hex');
  if (typeof expectedHash === 'string' &&
      /^[a-f0-9]{64}$/i.test(expectedHash) &&
      hash.toLowerCase() === expectedHash.toLowerCase()) {
    result.integrity = 'MATCH';
  } else {
    result.integrity = 'UNVERIFIED';
    fail('EXPECTED_HASH_MISSING_OR_MISMATCHED');
  }
  if (receipt?.schema !== 'indro.observation.v1') {
    fail('UNSUPPORTED_SCHEMA');
    return result;
  }
  const a = receipt.observations?.powershell;
  const b = receipt.observations?.cim;
  const starts = receipt.process_start;
  const t1 = Date.parse(starts?.powershell);
  const t2 = Date.parse(starts?.cim);
  const captured = Date.parse(receipt.captured_at);
  const validTime = [t1,t2,captured].every(Number.isFinite);
  const pid = Number.isSafeInteger(receipt.process_id) && receipt.process_id > 0 &&
    a?.pid === receipt.process_id && b?.pid === receipt.process_id;
  const pathMatch = typeof a?.path === 'string' && a.path.length > 0 &&
    typeof b?.path === 'string' &&
    a.path.toLowerCase() === b.path.toLowerCase() &&
    a.path.toLowerCase() === receipt.executable?.path?.toLowerCase();
  const digestValid = /^[a-f0-9]{64}$/i.test(receipt.executable?.sha256 ?? '');
  const timeMatch = validTime && Math.abs(t1-t2) <= 100;
  const consistent = pid && pathMatch && digestValid && timeMatch;
  result.consistency = consistent ? 'PASS' : 'FAIL';
  if (!consistent) fail('PROCESS_IDENTITY_INCONSISTENT');
  if (receipt.provenance?.independence_verified === false &&
      receipt.provenance?.shared_authority === 'Windows process state') {
    result.provenance = 'DECLARED_SHARED';
  } else {
    fail('UNSUPPORTED_PROVENANCE');
  }
  const now = options.now ?? Date.now();
  const maxAgeMs = options.maxAgeMs ?? 300000;
  if (validTime && Number.isFinite(now) &&
      Number.isFinite(maxAgeMs) && maxAgeMs >= 0 &&
      captured <= now && now - captured <= maxAgeMs) {
    result.freshness = 'WITHIN_WINDOW';
  } else {
    result.freshness = 'STALE_OR_INVALID';
    fail('STALE_OR_INVALID_TIMESTAMP');
  }
  // Shared authority is not independent proof.
  result.reusable = result.integrity === 'MATCH' &&
    result.consistency === 'PASS' &&
    result.provenance === 'DECLARED_SHARED' &&
    result.freshness === 'WITHIN_WINDOW';
  return result;
}
