import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stateRoot } from '../../commandhud/core.mjs';

export const BRIDGE_SCHEMA = 'indro.fl.bridge.v1';
export const RECEIPT_SCHEMA = 'indro.fl.receipt.v1';
const delay = milliseconds => new Promise(done => setTimeout(done, milliseconds));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

export function defaultMailbox() {
  const home = process.env.USERPROFILE || process.env.HOME;
  if (!home) throw new Error('HOME_DIRECTORY_UNAVAILABLE');
  return join(home, 'Documents', 'Image-Line', 'FL Studio', 'Settings', 'Hardware', 'FL Granulizer Bridge', 'indro-mailbox');
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function processPresent(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

export function discoverSession({ mailbox = defaultMailbox(), now = Date.now(), maxAgeMs = 43200000 } = {}) {
  const path = join(resolve(mailbox), 'session.json');
  if (!existsSync(path)) throw new Error('FL_BRIDGE_DISCONNECTED');
  const session = readJson(path);
  if (session?.schema !== BRIDGE_SCHEMA || typeof session.session_id !== 'string' ||
      !Number.isSafeInteger(session.process_id) || !Number.isFinite(session.heartbeat_unix_ms)) {
    throw new Error('FL_BRIDGE_SESSION_INVALID');
  }
  const ageMs = now - session.heartbeat_unix_ms;
  if (ageMs < 0 || ageMs > maxAgeMs || !processPresent(session.process_id)) throw new Error('FL_BRIDGE_STALE');
  return { ...session, heartbeat_age_ms: ageMs, mailbox: resolve(mailbox) };
}

export function createFlTransport({ mailbox = defaultMailbox(), timeoutMs = 5000, pollMs = 20, trigger: suppliedTrigger } = {}) {
  const root = resolve(mailbox);
  const requests = join(root, 'requests');
  const responses = join(root, 'responses');
  const trigger = suppliedTrigger ?? (() => {
    if (process.platform !== 'win32') throw new Error('FL_TRIGGER_REQUIRES_WINDOWS');
    const script = join(dirname(fileURLToPath(import.meta.url)), 'send-trigger.ps1');
    const value = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, 'FL-Granulizer-Bridge'],
      { encoding: 'utf8', windowsHide: true, timeout: timeoutMs });
    if (value.error || value.status !== 0) throw new Error(`FL_TRIGGER_FAILED:${value.error?.message ?? value.stderr?.trim() ?? value.status}`);
  });

  async function request(operation, { arguments: args = {}, target = {}, authorization = 'read-only', transactionId = randomUUID() } = {}) {
    const session = discoverSession({ mailbox: root });
    mkdirSync(requests, { recursive: true });
    mkdirSync(responses, { recursive: true });
    const body = {
      schema: BRIDGE_SCHEMA,
      transaction_id: transactionId,
      session_id: session.session_id,
      operation,
      target,
      arguments: args,
      authorization,
      submitted_unix_ms: Date.now(),
    };
    const destination = join(requests, `${transactionId}.json`);
    const temporary = `${destination}.tmp-${process.pid}-${randomUUID()}`;
    writeFileSync(temporary, `${JSON.stringify(body)}\n`, { flag: 'wx' });
    renameSync(temporary, destination);
    trigger();
    const responsePath = join(responses, `${transactionId}.json`);
    const deadline = Date.now() + timeoutMs;
    while (Date.now() <= deadline) {
      if (existsSync(responsePath)) {
        const response = readJson(responsePath);
        if (response?.schema !== BRIDGE_SCHEMA || response.transaction_id !== transactionId ||
            response.session_id !== session.session_id) throw new Error('FL_RESPONSE_IDENTITY_MISMATCH');
        return { request: body, response, responsePath };
      }
      await delay(pollMs);
    }
    const error = new Error('FL_RESPONSE_TIMEOUT_OUTCOME_UNKNOWN');
    error.transactionId = transactionId;
    error.requestPath = destination;
    throw error;
  }

  return { name: 'indro-fl-mailbox', request };
}

function capabilityOperation(capability) {
  const map = {
    'fl.plugin.parameter': 'plugin.get',
    'fl.status': 'status',
  };
  const operation = map[capability];
  if (!operation) throw new Error(`UNSUPPORTED_FL_CAPABILITY:${capability}`);
  return operation;
}

export function createFlAdapter(options = {}) {
  const transport = options.transport ?? createFlTransport(options);
  return {
    name: transport.name ?? 'indro-fl-mailbox',
    async observe(target, capability) {
      const operation = capabilityOperation(capability);
      const args = capability === 'fl.plugin.parameter'
        ? { channel: target.channel, parameter: target.parameter }
        : {};
      const value = await transport.request(operation, { arguments: args, target, authorization: 'read-only' });
      if (value.response.error) throw new Error(value.response.error);
      const result = value.response.result;
      return capability === 'fl.plugin.parameter'
        ? { ...result, value: result.value, observation_source: 'FL Studio plugins.getParamValue' }
        : { ...result, observation_source: 'FL Studio scripting API' };
    },
    async invoke(target, capability, args, context) {
      if (capability.id !== 'fl.plugin.parameter') return { error: 'UNSUPPORTED_FL_CAPABILITY' };
      const value = await transport.request('plugin.set', {
        transactionId: context.operation_id,
        arguments: { channel: target.channel, parameter: target.parameter, value: args.value },
        target,
        authorization: context.authorization,
      });
      const response = value.response;
      return {
        milestones: {
          RECEIVED: Number.isFinite(response.received_unix_ms),
          ACCEPTED: response.accepted === true,
          EXECUTED: response.executed === true,
        },
        error: response.error,
        host_result: response.result,
        command_id: response.transaction_id,
      };
    },
  };
}

export function persistFlReceipt(record, { evidenceRoot } = {}) {
  const root = resolve(evidenceRoot ?? join(stateRoot(), 'uai', 'fl-studio'));
  mkdirSync(root, { recursive: true });
  const id = record.transaction?.operation_id ?? randomUUID();
  const directory = join(root, `${new Date().toISOString().replace(/[:.]/g, '-')}-${id}`);
  mkdirSync(directory, { recursive: false });
  const payload = { schema: RECEIPT_SCHEMA, integrity_model: 'checksum-only-not-authenticated', ...record };
  const canonical = JSON.stringify(payload);
  const envelope = { payload, integrity: { algorithm: 'sha256', digest: sha256(canonical) } };
  const bytes = `${JSON.stringify(envelope, null, 2)}\n`;
  const path = join(directory, 'receipt.json');
  writeFileSync(path, bytes, { flag: 'wx' });
  return { path, sha256: sha256(bytes), evidence_id: id };
}

export function latestFlReceipt({ evidenceRoot } = {}) {
  const root = resolve(evidenceRoot ?? join(stateRoot(), 'uai', 'fl-studio'));
  if (!existsSync(root)) throw new Error('NO_FL_RECEIPTS');
  const candidates = readdirSync(root).map(name => join(root, name, 'receipt.json'))
    .filter(existsSync).sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  if (!candidates.length) throw new Error('NO_FL_RECEIPTS');
  return candidates[0];
}

export function validateFlReceipt(path, { expectedSession, expectedPlugin } = {}) {
  const result = { valid: false, integrity: 'FAIL', consistency: 'FAIL', target: 'FAIL', issues: [] };
  let envelope;
  try { envelope = readJson(path); } catch { result.issues.push('UNREADABLE_RECEIPT'); return result; }
  const payload = envelope?.payload;
  if (payload?.schema !== RECEIPT_SCHEMA) { result.issues.push('UNSUPPORTED_SCHEMA'); return result; }
  if (envelope?.integrity?.algorithm !== 'sha256' || envelope.integrity.digest !== sha256(JSON.stringify(payload))) {
    result.issues.push('CHECKSUM_MISMATCH'); return result;
  }
  result.integrity = 'CHECKSUM_MATCH_NOT_AUTHENTICATED';
  const tx = payload.transaction;
  if (!tx?.operation_id || !tx.target?.session_id || !tx.target?.plugin_name ||
      tx.milestones?.STATE_CONFIRMED !== true || tx.verdict !== 'STATE_CONFIRMED' ||
      tx.post_observation?.plugin_name !== tx.target.plugin_name ||
      tx.post_observation?.channel !== tx.target.channel || tx.post_observation?.parameter !== tx.target.parameter) {
    result.issues.push('CONTRADICTORY_OR_INCOMPLETE_TRANSACTION'); return result;
  }
  result.consistency = 'PASS';
  if ((expectedSession && tx.target.session_id !== expectedSession) ||
      (expectedPlugin && tx.target.plugin_name !== expectedPlugin)) {
    result.issues.push('WRONG_TARGET'); return result;
  }
  result.target = 'PASS';
  result.valid = true;
  return result;
}
