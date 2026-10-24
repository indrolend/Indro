import test from 'node:test';
import assert from 'node:assert/strict';
import { executeTransaction, MILESTONES } from './transaction.mjs';

const target = { app_id: 'fixture', process_id: 1 };
const capability = { id: 'parameter.spacing' };
test('readback confirms state without inventing transport or audio verification', async () => {
  let value = 0.5;
  const adapter = { name: 'fixture', observe: async () => ({ value }), invoke: async (_t,_c,args) => {
    value = args.value; return { expected: args.value, milestones: { EXECUTED: true } };
  }};
  const tx = await executeTransaction({ target, capability, args: { value: 0.75 }, adapter });
  assert.equal(tx.verdict, 'STATE_CONFIRMED');
  assert.equal(tx.milestones.EXECUTED, true);
  assert.equal(tx.milestones.RECEIVED, 'UNKNOWN');
  assert.equal(tx.milestones.EFFECT_VERIFIED, 'UNKNOWN');
  assert.equal(tx.evidence_hashes.length, 1);
});
test('mismatched readback is not success', async () => {
  const adapter = { observe: async () => ({ value: 0.2 }), invoke: async () => ({ expected: 0.8 }) };
  const tx = await executeTransaction({ target, capability, adapter });
  assert.equal(tx.verdict, 'READBACK_MISMATCH');
  assert.equal(tx.milestones.STATE_CONFIRMED, 'UNKNOWN');
});
test('failed transport does not assert execution', async () => {
  const adapter = { observe: async () => ({ value: 0 }), invoke: async () => { throw Error('offline'); } };
  const tx = await executeTransaction({ target, capability, adapter });
  assert.equal(tx.verdict, 'TRANSPORT_FAILED');
  assert.equal(tx.milestones.EXECUTED, 'UNKNOWN');
});
test('required target identity', async () => {
  await assert.rejects(executeTransaction({ target: {}, capability, adapter: {} }), TypeError);
});
