import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const DESKTOP_SCHEMA = 'indro.desktop-control.v1';

export function defaultDesktopRoot(env = process.env) {
  return resolve(env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'Indro', 'desktop-control');
}

function readJson(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
}

function atomicJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value)}\n`, { flag: 'wx' });
  renameSync(temporary, path);
}

function assertWindowsSid(value) {
  if (typeof value !== 'string' || !/^S-1-(?:\d+-){1,14}\d+$/.test(value)) throw new Error('DESKTOP_WORKER_OWNER_SID_INVALID');
  return value;
}

export function assignWindowsOwner(path, ownerSid, { run = spawnSync } = {}) {
  const sid = assertWindowsSid(ownerSid);
  const command = [
    '$ErrorActionPreference = "Stop"',
    '$acl = [System.IO.File]::GetAccessControl($env:INDRO_DESKTOP_REQUEST_PATH)',
    '$owner = [System.Security.Principal.SecurityIdentifier]::new($env:INDRO_DESKTOP_OWNER_SID)',
    '$acl.SetOwner($owner)',
    '[System.IO.File]::SetAccessControl($env:INDRO_DESKTOP_REQUEST_PATH, $acl)',
    '[System.IO.File]::GetAccessControl($env:INDRO_DESKTOP_REQUEST_PATH).GetOwner([System.Security.Principal.SecurityIdentifier]).Value',
  ].join('; ');
  const result = run('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command], {
    encoding: 'utf8', windowsHide: true, timeout: 5000,
    env: { ...process.env, INDRO_DESKTOP_REQUEST_PATH: resolve(path), INDRO_DESKTOP_OWNER_SID: sid },
  });
  if (result.status !== 0) throw new Error(`DESKTOP_REQUEST_OWNER_ASSIGNMENT_FAILED:${String(result.stderr || '').trim()}`);
  if (String(result.stdout || '').trim() !== sid) throw new Error('DESKTOP_REQUEST_OWNER_VERIFICATION_FAILED');
  return sid;
}

export function publishDesktopRequest(path, value, ownerSid) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value)}\n`, { flag: 'wx' });
  try {
    assignWindowsOwner(temporary, ownerSid);
    renameSync(temporary, path);
  } catch (error) {
    try { unlinkSync(temporary); } catch {}
    throw error;
  }
}

const wait = milliseconds => new Promise(resolveWait => setTimeout(resolveWait, milliseconds));

export function desktopWorkerStatus({ root = defaultDesktopRoot(), now = Date.now(), maxAgeMs = 5000 } = {}) {
  const path = join(resolve(root), 'worker.json');
  const value = readJson(path);
  if (!value || value.schema !== DESKTOP_SCHEMA || !Number.isInteger(value.pid) || !Number.isInteger(value.session_id)) {
    return { ready: false, reason: 'WORKER_UNAVAILABLE', path };
  }
  try { process.kill(value.pid, 0); }
  catch { return { ready: false, reason: 'WORKER_PROCESS_GONE', worker: value, path }; }
  const heartbeatAgeMs = now - Date.parse(value.heartbeat_at || '');
  if (!Number.isFinite(heartbeatAgeMs) || heartbeatAgeMs < 0 || heartbeatAgeMs > maxAgeMs) {
    return { ready: false, reason: 'WORKER_STALE', heartbeat_age_ms: heartbeatAgeMs, worker: value, path };
  }
  return { ready: true, heartbeat_age_ms: heartbeatAgeMs, worker: value, path };
}

function pythonExecutable() {
  const selected = spawnSync('py.exe', ['-3.14', '-c', 'import sys; print(sys.executable)'], {
    encoding: 'utf8', windowsHide: true, timeout: 5000,
  });
  const path = selected.status === 0 ? selected.stdout.trim() : '';
  if (!path || !existsSync(path)) throw new Error('PYTHON_3_14_WITH_DESKTOP_DEPENDENCIES_REQUIRED');
  return path;
}

export async function startDesktopWorker({ root = defaultDesktopRoot(), timeoutMs = 5000 } = {}) {
  if (process.platform !== 'win32') throw new Error('WINDOWS_ONLY');
  const current = desktopWorkerStatus({ root });
  if (current.ready) return { started: false, ...current };
  const script = join(here, 'windows_worker.py');
  const child = spawn(pythonExecutable(), [script, '--root', resolve(root)], {
    detached: true, windowsHide: true, stdio: 'ignore', shell: false,
  });
  child.unref();
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await wait(50);
    const status = desktopWorkerStatus({ root });
    if (status.ready) return { started: true, ...status };
  }
  throw new Error('INTERACTIVE_DESKTOP_WORKER_DID_NOT_START');
}

export function createDesktopTransport({ root = defaultDesktopRoot(), timeoutMs = 5000, pollMs = 20, trigger = null,
  publishRequest = publishDesktopRequest } = {}) {
  const mailbox = resolve(root);
  return {
    name: 'indro-windows-desktop-mailbox',
    async request(operation, argumentsValue = {}) {
      const status = desktopWorkerStatus({ root: mailbox });
      if (!status.ready) throw new Error(status.reason);
      const requestId = randomUUID();
      const request = {
        schema: DESKTOP_SCHEMA, request_id: requestId, operation,
        arguments: argumentsValue, authorization: { principal: 'local-user', scope: operation },
        requested_at: new Date().toISOString(), requester_pid: process.pid,
      };
      const requestPath = join(mailbox, 'requests', `${requestId}.json`);
      const responsePath = join(mailbox, 'responses', `${requestId}.json`);
      publishRequest(requestPath, request, status.worker.owner_sid);
      if (trigger) await trigger({ request, requestPath, responsePath });
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        if (existsSync(responsePath)) {
          const response = readJson(responsePath);
          if (!response || response.schema !== DESKTOP_SCHEMA || response.request_id !== requestId) {
            throw new Error('DESKTOP_RESPONSE_IDENTITY_INVALID');
          }
          return { request, response, worker: status.worker };
        }
        await wait(pollMs);
      }
      const error = new Error('DESKTOP_OPERATION_TIMEOUT_OUTCOME_UNKNOWN');
      error.transactionId = requestId;
      throw error;
    },
  };
}

