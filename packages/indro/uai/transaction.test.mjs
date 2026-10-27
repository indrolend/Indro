import test from 'node:test';
import assert from 'node:assert/strict';
import { executeTransaction } from './transaction.mjs';

const target = { app_id: 'fixture', process_id: 1 };
const capability = { id: 'parameter.spacing' };
const run = (adapter, args = { value: 0.75 }, extra = {}) =>
  executeTransaction({ target, capability, args, adapter, ...extra });

test('readback confirms state without inventing receipt or effect evidence', async () => {
  let value = 0.5;
  const adapter = { name: 'fixture', observe: async () => ({ value }), invoke: async (_t, _c, args) => {
    value = args.value; return { milestones: { EXECUTED: true } };
  }};
  const tx = await run(adapter);
  assert.equal(tx.verdict, 'STATE_CONFIRMED');
  assert.equal(tx.milestones.EXECUTED, true);
  assert.equal(tx.milestones.RECEIVED, 'UNKNOWN');
  assert.equal(tx.milestones.EFFECT_VERIFIED, 'UNKNOWN');
  assert.equal(tx.evidence_hashes.length, 1);
});
test('readback mismatch is not success', async () => {
  const tx = await run({ observe: async () => ({ value: 0.2 }), invoke: async () => ({}) });
  assert.equal(tx.verdict, 'READBACK_MISMATCH');
});
test('adapter cannot forge caller expectation', async () => {
  const tx = await run({ observe: async () => ({ value: 0.2 }), invoke: async () => ({ expected: 0.2 }) });
  assert.equal(tx.verdict, 'READBACK_MISMATCH');
});
test('quantized readback needs explicit tolerance', async () => {
  const adapter = { observe: async () => ({ value: 0.7486 }), invoke: async () => ({}) };
  assert.equal((await run(adapter, { value: 0.748 }, { tolerance: 0.001 })).verdict, 'STATE_CONFIRMED');
  assert.equal((await run(adapter, { value: 0.748 })).verdict, 'READBACK_MISMATCH');
});
test('failed invocation remains unknown rather than confirmed failure to deliver', async () => {
  const tx = await run({ observe: async () => ({ value: 0 }), invoke: async () => { throw Error('timeout'); } });
  assert.equal(tx.verdict, 'TRANSPORT_UNKNOWN');
  assert.equal(tx.milestones.EXECUTED, 'UNKNOWN');
});
test('pre-observation failure never invokes the application', async () => {
  let invoked = false;
  const tx = await run({ observe: async () => { throw Error('offline'); }, invoke: async () => { invoked = true; } });
  assert.equal(tx.verdict, 'OBSERVATION_FAILED');
  assert.equal(invoked, false);
});
test('post-observation failure is not transport failure', async () => {
  let calls = 0;
  const tx = await run({ observe: async () => { if (++calls === 2) throw Error('readback'); return { value: 0 }; }, invoke: async () => ({}) });
  assert.equal(tx.verdict, 'OBSERVATION_FAILED');
});
test('reported execution error cannot be overwritten by readback', async () => {
  const tx = await run({ observe: async () => ({ value: 0.75 }), invoke: async () => ({ error: 'rejected' }) });
  assert.equal(tx.verdict, 'EXECUTION_FAILED');
  assert.equal(tx.milestones.STATE_CONFIRMED, 'UNKNOWN');
});
test('invalid target is rejected', async () => {
  await assert.rejects(run({}), TypeError);
  await assert.rejects(executeTransaction({ target: {}, capability, adapter: {} }), TypeError);
});
