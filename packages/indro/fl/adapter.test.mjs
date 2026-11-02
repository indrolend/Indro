import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFlAdapter, persistFlReceipt, validateFlReceipt } from './adapter.mjs';
import { executeTransaction } from '../uai/transaction.mjs';

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

test('FL parameter mutation refuses missing or non-restorable pre-state', async () => {
  for (const observed of [null, undefined, -0.1, 1.1]) {
    const operations = [];
    const transport = { name: 'fixture', async request(operation) {
      operations.push(operation);
      return { response: { result: operation === 'plugin.get' ? { value: observed } : {} } };
    } };
    const tx = await executeTransaction({
      target: { app_id: 'fl-studio', channel: 0, parameter: 2 },
      capability: { id: 'fl.plugin.parameter' }, args: { value: 0.25 },
      adapter: createFlAdapter({ transport }), verify: 'readback',
      authorization: 'explicit-user-write', tolerance: 0.002
    });
    assert.equal(tx.verdict, 'OBSERVATION_FAILED');
    assert.equal(operations.filter(operation => operation === 'plugin.set').length, 0);
  }
  let current = 0.412;
  const operations = [];
  const transport = { name: 'fixture', async request(operation, request) {
    operations.push(operation);
    if (operation === 'plugin.get') return { response: { result: { value: current } } };
    if (operation === 'plugin.set') {
      current = request.arguments.value;
      return { response: { result: {}, accepted: true, executed: true, received_unix_ms: Date.now() } };
    }
    throw new Error('UNEXPECTED_OPERATION');
  } };
  const tx = await executeTransaction({
    target: { app_id: 'fl-studio', channel: 0, parameter: 2 },
    capability: { id: 'fl.plugin.parameter' }, args: { value: 0.25 },
    adapter: createFlAdapter({ transport }), verify: 'readback',
    authorization: 'explicit-user-write', tolerance: 0.002
  });
  assert.equal(tx.verdict, 'STATE_CONFIRMED');
  assert.equal(current, 0.25);
  assert.equal(operations.filter(operation => operation === 'plugin.set').length, 1);
});
