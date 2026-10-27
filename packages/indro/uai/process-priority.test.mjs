import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import { runSpawnedPriority } from './process-priority.mjs';

test('owned-child lifecycle confirms readback, shared authority, durable evidence, and cleanup', async () => {
  const root = mkdtempSync(join(tmpdir(), 'indro-process-priority-'));
  let alive = true;
  let priority = 'Normal';
  const child = fakeChild(77, () => { alive = false; });
  const snapshot = () => {
    if (!alive) throw new Error('not found');
    return { powershell: { pid: 77, creation_time: '2026-01-01T00:00:00.000Z', path: 'node.exe', priority },
      cim: { pid: 77, creation_time: '2026-01-01T00:00:00.000Z', path: 'node.exe', priority: priority === 'Normal' ? 8 : 6 } };
  };
  const result = await runSpawnedPriority({ evidenceRoot: root, dependencies: { allowNonWindows: true,
    spawnChild: () => child, snapshot, probe: () => ({ present: alive }), adapter: fakeAdapter(snapshot, value => { priority = value; }) } });
  assert.equal(result.transaction.verdict, 'STATE_CONFIRMED');
  assert.equal(result.cleanup.confirmed, true);
  assert.equal(result.provenance.independence_verified, false);
  assert.ok(existsSync(result.evidence.path));
  assert.equal(JSON.parse(readFileSync(result.evidence.path)).cleanup.process_state, 'ABSENT');
});

test('cleanup still runs when identity changes before transaction', async () => {
  let calls = 0;
  let killed = false;
  const child = fakeChild(88, () => { killed = true; });
  const snapshot = () => ({ powershell: { pid: 88, creation_time: calls++ ? 'new' : 'old', priority: 'Normal' },
    cim: { pid: 88, creation_time: 'old', priority: 8 } });
  const result = await runSpawnedPriority({ evidenceRoot: mkdtempSync(join(tmpdir(), 'indro-process-negative-')),
    dependencies: { allowNonWindows: true, spawnChild: () => child, snapshot, probe: () => ({ present: false }), adapter: fakeAdapter(snapshot, () => {}) } });
  assert.equal(result.transaction.verdict, 'OBSERVATION_FAILED');
  assert.equal(killed, true);
  assert.equal(result.cleanup.confirmed, true);
});


test('probe failure does not falsely confirm owned-child cleanup', async () => {
  let alive = true;
  const child = fakeChild(99, () => { alive = false; });
  const snapshot = () => ({ powershell: { pid: 99, creation_time: '2026-01-01T00:00:00.000Z', path: 'node.exe', priority: 'BelowNormal' },
    cim: { pid: 99, creation_time: '2026-01-01T00:00:00.000Z', path: 'node.exe', priority: 6 } });
  const result = await runSpawnedPriority({ evidenceRoot: mkdtempSync(join(tmpdir(), 'indro-process-unknown-')),
    dependencies: { allowNonWindows: true, spawnChild: () => child, snapshot,
      probe: () => { throw new Error('access denied'); }, adapter: fakeAdapter(snapshot, () => {}) } });
  assert.equal(alive, false);
  assert.equal(result.transaction.verdict, 'STATE_CONFIRMED');
  assert.equal(result.cleanup.process_state, 'UNKNOWN');
  assert.equal(result.cleanup.confirmed, false);
  assert.equal(JSON.parse(readFileSync(result.evidence.path)).cleanup.confirmed, false);
});

function fakeChild(pid, stopped) {
  const child = Object.assign(new EventEmitter(), { pid, exitCode: null });
  child.kill = () => { stopped(); child.exitCode = 0; queueMicrotask(() => child.emit('exit', 0)); return true; };
  return child;
}

function fakeAdapter(snapshot, set) {
  return { name: 'fake-windows', observe: async target => {
    const data = snapshot();
    if (data.powershell.creation_time !== target.creation_time) throw new Error('Process identity mismatch (possible PID reuse)');
    return { value: data.powershell.priority, secondary_observation: { source: 'Win32_Process/CIM', priority: data.cim.priority },
      provenance: { shared_authority: 'Windows process state', independence_verified: false } };
  }, invoke: async (_target, _capability, args) => { set(args.value); return { milestones: { EXECUTED: true } }; } };
}
