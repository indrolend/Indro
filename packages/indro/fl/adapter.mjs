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
const within = (actual, expected, tolerance = 0) => typeof actual === 'number' && Number.isFinite(actual) &&
  typeof expected === 'number' && Number.isFinite(expected) && Math.abs(actual - expected) <= tolerance;

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
    'fl.transport.playing': 'transport.status',
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
      if (capability === 'fl.transport.playing') {
        return { ...result, value: result.playing, observation_source: 'FL Studio transport.isPlaying' };
      }
      return capability === 'fl.plugin.parameter'
        ? { ...result, value: result.value, observation_source: 'FL Studio plugins.getParamValue' }
        : { ...result, observation_source: 'FL Studio scripting API' };
    },
    async invoke(target, capability, args, context) {
      if (!['fl.plugin.parameter', 'fl.transport.playing'].includes(capability.id)) return { error: 'UNSUPPORTED_FL_CAPABILITY' };
      const transportOperation = capability.id === 'fl.transport.playing'
        ? (args.value ? 'transport.play' : 'transport.stop')
        : 'plugin.set';
      const argumentsValue = capability.id === 'fl.transport.playing'
        ? {}
        : { channel: target.channel, parameter: target.parameter, value: args.value };
      const value = await transport.request(transportOperation, {
        transactionId: context.operation_id,
        arguments: argumentsValue,
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
  const id = record.transaction?.operation_id ?? record.transactions?.mutation?.operation_id ?? randomUUID();
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
  if (payload.kind === 'fl.plugin.parameter.trial') {
    const mutation = payload.transactions?.mutation;
    const restoration = payload.transactions?.restoration;
    const sameTarget = mutation?.target?.app_id === 'fl-studio' && mutation.target.plugin_name &&
      restoration?.target?.app_id === mutation.target.app_id &&
      restoration?.target?.session_id === mutation.target.session_id &&
      restoration?.target?.process_id === mutation.target.process_id &&
      restoration?.target?.channel === mutation.target.channel &&
      restoration?.target?.parameter === mutation.target.parameter &&
      restoration?.target?.plugin_name === mutation.target.plugin_name;
    const baseline = mutation?.pre_observation?.value;
    const tolerance = payload.expected?.tolerance;
    const complete = sameTarget && mutation.verification?.outcome === 'CONFIRMED' &&
      restoration.verification?.outcome === 'CONFIRMED' &&
      typeof tolerance === 'number' && Number.isFinite(tolerance) && tolerance >= 0 &&
      within(mutation.post_observation?.value, mutation.arguments?.value, tolerance) &&
      restoration.arguments?.value === baseline && within(restoration.post_observation?.value, baseline, tolerance) &&
      payload.verification?.outcome === 'CONFIRMED';
    if (!complete) { result.issues.push('CONTRADICTORY_OR_INCOMPLETE_TRIAL'); return result; }
    result.consistency = 'PASS';
    if ((expectedSession && String(mutation.target.session_id) !== String(expectedSession)) ||
        (expectedPlugin && mutation.target.plugin_name !== expectedPlugin)) {
      result.issues.push('WRONG_TARGET'); return result;
    }
    result.target = 'PASS';
    result.valid = true;
    return result;
  }
  const tx = payload.transaction;
  const parameterReceipt = Boolean(tx?.target?.plugin_name) &&
    tx.post_observation?.plugin_name === tx.target.plugin_name &&
    tx.post_observation?.channel === tx.target.channel &&
    tx.post_observation?.parameter === tx.target.parameter;
  const browserReceipt = tx?.capability_id === 'fl.browser.visibility' &&
    tx.target?.app_id === 'fl-studio' && tx.target?.process_id > 0 &&
    Boolean(tx.target?.executable_sha256) && Boolean(tx.target?.session_id) &&
    tx.post_observation?.application?.app_id === tx.target.app_id &&
    tx.post_observation?.application?.process_id === tx.target.process_id &&
    tx.post_observation?.application?.process_start === tx.target.process_start &&
    tx.post_observation?.application?.executable_sha256 === tx.target.executable_sha256 &&
    tx.post_observation?.application?.session_id === tx.target.session_id &&
    tx.post_observation?.application?.browser_handle === tx.target.browser_handle &&
    tx.post_observation?.application?.browser_class === tx.target.browser_class &&
    typeof tx.arguments?.value === 'boolean' && tx.post_observation?.value === tx.arguments.value;
  const transportReceipt = tx?.capability_id === 'fl.transport.playing' &&
    tx.target?.app_id === 'fl-studio' && Boolean(tx.target?.session_id) && tx.target?.process_id > 0 &&
    typeof tx.arguments?.value === 'boolean' && tx.post_observation?.value === tx.arguments.value &&
    tx.post_observation?.observation_source === 'FL Studio transport.isPlaying';
  const noteReceipt = tx?.capability_id === 'fl.piano-roll.note' && tx.target?.app_id === 'fl-studio' &&
    Boolean(tx.target?.session_id) && tx.target?.process_id > 0 && Number.isInteger(tx.target?.channel) &&
    Boolean(tx.target?.channel_name) && Number.isInteger(tx.target?.pattern) && Number.isInteger(tx.target?.note?.time) &&
    tx.arguments?.value === true && tx.post_observation?.value === true && tx.post_observation?.matches > 0 &&
    tx.post_observation?.observation_source === 'flpianoroll.score.getNote';
  if (!tx?.operation_id || tx.milestones?.STATE_CONFIRMED !== true ||
      tx.verdict !== 'STATE_CONFIRMED' || (!parameterReceipt && !browserReceipt && !transportReceipt && !noteReceipt)) {
    result.issues.push('CONTRADICTORY_OR_INCOMPLETE_TRANSACTION'); return result;
  }
  result.consistency = 'PASS';
  // The FL scripting bridge uses its own UUID-like session identity, while the
  // desktop adapter records the authoritative Windows session id. A bridge
  // session supplied by `fl verify --latest` therefore applies only to bridge
  // parameter receipts; desktop identity is checked by the browser contract
  // above and by a fresh desktop observation.
  if (((parameterReceipt || transportReceipt || noteReceipt) && expectedSession && String(tx.target.session_id) !== String(expectedSession)) ||
      (parameterReceipt && expectedPlugin && tx.target.plugin_name !== expectedPlugin)) {
    result.issues.push('WRONG_TARGET'); return result;
  }
  result.target = 'PASS';
  result.valid = true;
  return result;
}
