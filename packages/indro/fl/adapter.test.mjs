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

test('FL Browser receipt requires matching application identity and requested visibility', () => {
  const root = mkdtempSync(join(tmpdir(), 'indro-fl-browser-receipt-'));
  const browser = transaction({
    target: {
      app_id: 'fl-studio', process_id: 42, process_start: 100,
      executable_sha256: 'abc', session_id: 1,
      browser_handle: 99, browser_class: 'TSampleListForm',
    },
    capability_id: 'fl.browser.visibility',
    arguments: { value: false },
    post_observation: {
      value: false,
      application: {
        app_id: 'fl-studio', process_id: 42, process_start: 100,
        executable_sha256: 'abc', session_id: 1,
        browser_handle: 99, browser_class: 'TSampleListForm',
      },
    },
  });
  let evidence = persistFlReceipt({ transaction: browser }, { evidenceRoot: root });
  assert.equal(validateFlReceipt(evidence.path, { expectedSession: 'bridge-session-is-not-windows-session' }).valid, true);

  const second = join(root, 'wrong-state'); mkdirSync(second);
  evidence = persistFlReceipt({ transaction: {
    ...browser,
    post_observation: { ...browser.post_observation, value: true },
  } }, { evidenceRoot: second });
  assert.deepEqual(validateFlReceipt(evidence.path).issues, ['CONTRADICTORY_OR_INCOMPLETE_TRANSACTION']);
});

test('transport receipt requires confirmed FL host readback', () => {
  const root = mkdtempSync(join(tmpdir(), 'indro-fl-transport-receipt-'));
  const evidence = persistFlReceipt({ transaction: transaction({
    target: { app_id: 'fl-studio', session_id: 'session-1', process_id: 42 },
    capability_id: 'fl.transport.playing',
    arguments: { value: true },
    post_observation: { value: true, playing: true, observation_source: 'FL Studio transport.isPlaying' },
  }) }, { evidenceRoot: root });
  assert.equal(validateFlReceipt(evidence.path, { expectedSession: 'session-1' }).valid, true);
});

test('trial receipt requires confirmed mutation and restoration to the observed baseline', () => {
  const root = mkdtempSync(join(tmpdir(), 'indro-fl-trial-receipt-'));
  const target = { app_id: 'fl-studio', session_id: 'session-1', process_id: 42,
    channel: 0, plugin_name: 'Fruity Granulizer', parameter: 2 };
  const mutation = transaction({
    target, arguments: { value: 0.25 }, verification: { outcome: 'CONFIRMED' },
    pre_observation: { ...target, value: 0.5 }, post_observation: { ...target, value: 0.251 },
  });
  const restoration = transaction({
    operation_id: 'operation-2', target, arguments: { value: 0.5 }, verification: { outcome: 'CONFIRMED' },
    pre_observation: { ...target, value: 0.251 }, post_observation: { ...target, value: 0.501 },
  });
  let evidence = persistFlReceipt({
    kind: 'fl.plugin.parameter.trial', expected: { mutation: 0.25, restoration: 0.5, tolerance: 0.002 },
    transactions: { mutation, restoration }, verification: { outcome: 'CONFIRMED' },
  }, { evidenceRoot: root });
  assert.equal(validateFlReceipt(evidence.path, { expectedSession: 'session-1', expectedPlugin: 'Fruity Granulizer' }).valid, true);

  const incompleteRoot = join(root, 'incomplete'); mkdirSync(incompleteRoot);
  evidence = persistFlReceipt({
    kind: 'fl.plugin.parameter.trial', expected: { mutation: 0.25, restoration: 0.5, tolerance: 0.002 },
    transactions: { mutation, restoration: null }, verification: { outcome: 'UNKNOWN' },
  }, { evidenceRoot: incompleteRoot });
  assert.deepEqual(validateFlReceipt(evidence.path).issues, ['CONTRADICTORY_OR_INCOMPLETE_TRIAL']);
});

test('Piano Roll receipt requires native score readback and exact semantic target', () => {
  const root = mkdtempSync(join(tmpdir(), 'indro-fl-note-receipt-'));
  const tx = transaction({
    target: { app_id: 'fl-studio', session_id: 'session-1', process_id: 42, channel: 0,
      channel_name: '808 Kick', pattern: 1, note: { number: 60, time: 144, length: 24, velocity: 100 / 127 } },
    capability_id: 'fl.piano-roll.note', arguments: { value: true },
    post_observation: { value: true, matches: 1, observation_source: 'flpianoroll.score.getNote' },
  });
  let evidence = persistFlReceipt({ kind: 'fl.piano-roll.note.add', transaction: tx }, { evidenceRoot: root });
  assert.equal(validateFlReceipt(evidence.path, { expectedSession: 'session-1' }).valid, true);
  const wrong = join(root, 'wrong'); mkdirSync(wrong);
  evidence = persistFlReceipt({ kind: 'fl.piano-roll.note.add', transaction: {
    ...tx, post_observation: { ...tx.post_observation, value: false, matches: 0 },
  } }, { evidenceRoot: wrong });
  assert.deepEqual(validateFlReceipt(evidence.path).issues, ['CONTRADICTORY_OR_INCOMPLETE_TRANSACTION']);
});
