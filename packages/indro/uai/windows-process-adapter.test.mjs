import test from 'node:test';
import assert from 'node:assert/strict';
import { createWindowsProcessAdapter } from './windows-process-adapter.mjs';

const target = { process_id: 42, creation_time: '2026-01-01T00:00:00.0000000Z' };
const observation = (creation = target.creation_time) => ({
  powershell: { pid: 42, creation_time: creation, path: 'node.exe', priority: 'Normal' },
  cim: { pid: 42, creation_time: creation, path: 'node.exe', priority: 8 }
});

test('adapter exposes CIM as declared shared authority, not independent proof', async () => {
  const result = await createWindowsProcessAdapter({ snapshot: () => observation() }).observe(target);
  assert.equal(result.value, 'Normal');
  assert.equal(result.provenance.shared_authority, 'Windows process state');
  assert.equal(result.provenance.independence_verified, false);
  assert.equal(result.secondary_observation.source, 'Win32_Process/CIM');
  assert.equal(result.secondary_observation.consistency, 'CONSISTENT');
});

test('adapter rejects a reused PID before readback', async () => {
  const adapter = createWindowsProcessAdapter({ snapshot: () => observation('2026-01-02T00:00:00.0000000Z') });
  await assert.rejects(adapter.observe(target), /PID reuse/);
});

test('adapter rejects missing creation-time identity and unsupported priority', async () => {
  const adapter = createWindowsProcessAdapter({ snapshot: () => observation() });
  await assert.rejects(adapter.observe({ process_id: 42 }), /creation-time identity/);
  await assert.rejects(adapter.invoke(target, { id: 'process.priority' }, { value: 'Normal' }), /Unsupported priority/);
});

test('contradictory CIM PID, creation time, path, and priority fail closed', async () => {
  const changes = [
    [o => { o.cim.pid = 43; }, /CIM process identity mismatch/],
    [o => { o.cim.creation_time = '2026-01-02T00:00:00.000Z'; }, /CIM creation-time mismatch/],
    [o => { o.cim.path = 'different.exe'; }, /CIM executable path mismatch/],
    [o => { o.cim.priority = 13; }, /CIM priority contradicts primary readback/]
  ];
  for (const [change, expected] of changes) {
    const snapshot = observation();
    change(snapshot);
    await assert.rejects(createWindowsProcessAdapter({ snapshot: () => snapshot }).observe(target), expected);
  }
});
