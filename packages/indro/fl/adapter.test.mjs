import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { persistFlReceipt, validateFlReceipt } from './adapter.mjs';

function transaction(overrides = {}) {
  return {
    operation_id: 'operation-1', verdict: 'STATE_CONFIRMED',
    target: { session_id: 'session-1', channel: 0, plugin_name: 'Fruity Granulizer', parameter: 2 },
    milestones: { STATE_CONFIRMED: true },
    post_observation: { channel: 0, plugin_name: 'Fruity Granulizer', parameter: 2, value: 0.25 },
    ...overrides,
  };
}

test('real receipt contract accepts consistent checksum-only host readback', () => {
  const root = mkdtempSync(join(tmpdir(), 'indro-fl-receipt-'));
  const evidence = persistFlReceipt({ transaction: transaction() }, { evidenceRoot: root });
  const result = validateFlReceipt(evidence.path, { expectedSession: 'session-1', expectedPlugin: 'Fruity Granulizer' });
  assert.equal(result.valid, true);
  assert.equal(result.integrity, 'CHECKSUM_MATCH_NOT_AUTHENTICATED');
});

test('tampered receipt is rejected', () => {
  const root = mkdtempSync(join(tmpdir(), 'indro-fl-tamper-'));
  const evidence = persistFlReceipt({ transaction: transaction() }, { evidenceRoot: root });
  const value = JSON.parse(readFileSync(evidence.path, 'utf8'));
  value.payload.transaction.post_observation.value = 0.9;
  writeFileSync(evidence.path, JSON.stringify(value));
  assert.deepEqual(validateFlReceipt(evidence.path).issues, ['CHECKSUM_MISMATCH']);
});

test('wrong session, plugin, and contradictory readback are rejected', () => {
  const root = mkdtempSync(join(tmpdir(), 'indro-fl-target-'));
  let evidence = persistFlReceipt({ transaction: transaction() }, { evidenceRoot: root });
  assert.equal(validateFlReceipt(evidence.path, { expectedSession: 'other' }).valid, false);
  const second = join(root, 'second'); mkdirSync(second);
  evidence = persistFlReceipt({ transaction: transaction({
    post_observation: { channel: 1, plugin_name: 'Other', parameter: 2, value: 0.25 }
  }) }, { evidenceRoot: second });
  assert.equal(validateFlReceipt(evidence.path).valid, false);
});
