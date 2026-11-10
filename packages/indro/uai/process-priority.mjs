import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { stateRoot } from '../../commandhud/core.mjs';
import { executeTransaction } from './transaction.mjs';
import { createWindowsProcessAdapter, processIdentityProbe, processSnapshot } from './windows-process-adapter.mjs';

const delay = ms => new Promise(done => setTimeout(done, ms));

async function waitForSnapshot(pid, snapshot, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    try { return snapshot(pid); } catch (error) { last = error; await delay(50); }
  }
  throw last ?? new Error('Spawned process was not observable');
}

async function stopOwnedChild(child, identity, probe, timeoutMs = 5000) {
  let exitObserved = child.exitCode !== null;
  if (!exitObserved) {
    child.kill();
    exitObserved = await Promise.race([new Promise(done => child.once('exit', () => done(true))), delay(timeoutMs).then(() => false)]);
  }
  if (!exitObserved && child.exitCode === null) child.kill('SIGKILL');
  if (!exitObserved) exitObserved = await Promise.race([new Promise(done => child.once('exit', () => done(true))), delay(timeoutMs).then(() => false)]);
  // Probe failures and incomplete identity are UNKNOWN, never evidence of termination.
  let processState = 'UNKNOWN';
  try {
    const current = probe(identity.process_id);
    if (current?.present === false) processState = 'ABSENT';
    else if (current?.present === true && identity.creation_time && current.creation_time === identity.creation_time)
      processState = 'OWNED_PROCESS_PRESENT';
    else if (current?.present === true && identity.creation_time && current.creation_time)
      processState = 'PID_REUSED';
  } catch { /* Unobservable process state is not absence. */ }
  return { requested: true, exit_observed: exitObserved || child.exitCode !== null, process_state: processState,
    confirmed: processState === 'ABSENT' || processState === 'PID_REUSED' };
}

function persistEvidence(record, evidenceRoot) {
  const root = resolve(evidenceRoot ?? join(stateRoot(), 'uai', 'windows-process-priority'));
  mkdirSync(root, { recursive: true });
  const directory = join(root, `${new Date().toISOString().replace(/[:.]/g, '-')}-${record.transaction.operation_id}-${randomUUID()}`);
  mkdirSync(directory, { recursive: false });
  const receiptPath = join(directory, 'receipt.json');
  const bytes = `${JSON.stringify(record, null, 2)}\n`;
  writeFileSync(receiptPath, bytes, { flag: 'wx' });
  return { path: receiptPath, sha256: createHash('sha256').update(bytes).digest('hex') };
}

export async function runSpawnedPriority({ value = 'BelowNormal', evidenceRoot, dependencies = {} } = {}) {
  if (process.platform !== 'win32' && !dependencies.allowNonWindows) throw new Error('Windows process priority is only supported on Windows');
  if (value !== 'BelowNormal') throw new Error('Only BelowNormal is supported by this canonical command');
  const spawnChild = dependencies.spawnChild ?? (() => spawn(process.execPath, ['-e', 'setInterval(()=>{}, 60000)'], {
    stdio: 'ignore', windowsHide: true, env: { ...process.env, INDRO_DISPOSABLE_CHILD: randomUUID() }
  }));
  const snapshot = dependencies.snapshot ?? processSnapshot;
  const probe = dependencies.probe ?? (dependencies.snapshot
    ? pid => { const value = snapshot(pid); return { present: true, creation_time: value.powershell.creation_time }; }
    : processIdentityProbe);
  const adapter = dependencies.adapter ?? createWindowsProcessAdapter({ snapshot });
  const child = spawnChild();
  if (!child || !Number.isSafeInteger(child.pid)) throw new Error('Disposable child spawn failed');
  let identity;
  let transaction;
  let cleanup;
  try {
    const initial = await waitForSnapshot(child.pid, snapshot);
    identity = { process_id: child.pid, creation_time: initial.powershell.creation_time };
    transaction = await executeTransaction({
      target: { app_id: 'windows-process', ...identity, ownership: 'spawned-disposable-child' },
      capability: { id: 'process.priority' }, args: { value }, adapter
    });
  } finally {
    cleanup = await stopOwnedChild(child, identity ?? { process_id: child.pid, creation_time: null }, probe);
  }
  const record = {
    schema: 'indro.windows-process-priority.v1',
    ownership: { kind: 'spawned-disposable-child', process_id: identity.process_id, creation_time: identity.creation_time },
    transaction,
    secondary_observation: transaction?.post_observation?.secondary_observation ?? null,
    provenance: transaction?.post_observation?.provenance ?? null,
    cleanup,
    limitations: ['CIM and Get-Process are secondary observations of shared Windows process state; independence is not verified.']
  };
  return { ...record, evidence: persistEvidence(record, evidenceRoot) };
}
