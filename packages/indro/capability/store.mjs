import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stateRoot } from '../../commandhud/core.mjs';
import { createFlTransport, defaultMailbox, discoverSession, latestFlReceipt, validateFlReceipt } from '../fl/adapter.mjs';
import { runFlCli } from '../fl/cli.mjs';
import { verifyPng } from '../paint/artifact.mjs';

export const CAPABILITY_SCHEMA = 'indro.capability/v1';
const here = dirname(fileURLToPath(import.meta.url));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const canonical = value => JSON.stringify(value);
const fileIdentity = path => {
  const bytes = readFileSync(path);
  return { path: resolve(path), bytes: bytes.length, sha256: sha256(bytes) };
};

export function capabilityRoot(options = {}) {
  return resolve(options.capabilityRoot ?? join(stateRoot(options.env), 'continuum', 'capabilities'));
}

function adapterPath() { return resolve(here, '..', 'fl', 'adapter.mjs'); }
function paintVerifierPath() { return resolve(here, '..', 'paint', 'artifact.mjs'); }
function bridgePath(mailbox = defaultMailbox()) {
  return join(dirname(resolve(mailbox)), 'device_FLGranulizerBridge.py');
}

function envelope(payload) {
  return { payload, integrity: { algorithm: 'sha256', digest: sha256(canonical(payload)) } };
}

function readEnvelope(path) {
  const value = JSON.parse(readFileSync(path, 'utf8'));
  if (value?.payload?.schema !== CAPABILITY_SCHEMA) throw new Error('INCOMPATIBLE_CAPABILITY_SCHEMA');
  if (value?.integrity?.algorithm !== 'sha256' || value.integrity.digest !== sha256(canonical(value.payload))) {
    throw new Error('CAPABILITY_CHECKSUM_MISMATCH');
  }
  return value.payload;
}

function versions(root) {
  if (!existsSync(root)) return [];
  return readdirSync(root).filter(name => name.endsWith('.json')).map(name => join(root, name))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
}

export function latestCapabilityPath(id, options = {}) {
  const values = versions(join(capabilityRoot(options), id));
  if (!values.length) throw new Error('CAPABILITY_NOT_FOUND');
  return values[0];
}

export function loadCapability(id, options = {}) {
  return readEnvelope(latestCapabilityPath(id, options));
}

export function listCapabilities(options = {}) {
  const root = capabilityRoot(options);
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true }).filter(entry => entry.isDirectory()).flatMap(entry => {
    try {
      const record = loadCapability(entry.name, options);
      return [{ id: record.id, goal: record.goal, target: record.target, retained_at: record.retained_at }];
    } catch { return []; }
  }).sort((a, b) => a.id.localeCompare(b.id));
}

export function retainFlParameterCapability({ receiptPath, mailbox = defaultMailbox(), ...options } = {}) {
  const path = receiptPath ?? latestFlReceipt(options);
  const receiptCheck = validateFlReceipt(path);
  if (!receiptCheck.valid) throw new Error(`SOURCE_RECEIPT_INVALID:${receiptCheck.issues.join(',')}`);
  const receipt = JSON.parse(readFileSync(path, 'utf8')).payload;
  const tx = receipt.transaction;
  const observation = tx.post_observation;
  if (tx.capability_id !== 'fl.plugin.parameter' || !observation?.parameter_name) throw new Error('RECEIPT_NOT_COMPILABLE');
  const session = discoverSession({ mailbox });
  const id = `fl.plugin.parameter.${observation.parameter_name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;
  const payload = {
    schema: CAPABILITY_SCHEMA,
    schema_version: 1,
    id,
    goal: `Set ${observation.parameter_name} on ${tx.target.plugin_name}`,
    parameters: { value: { type: 'number', minimum: 0, maximum: 1 } },
    target: {
      application: 'fl-studio',
      plugin_name: tx.target.plugin_name,
      parameter_name: observation.parameter_name,
      observed_mapping: { channel: tx.target.channel, parameter: tx.target.parameter },
      identity_validation: 'rediscover unique plugin and parameter names through FL Studio host API',
    },
    invocation: { adapter: 'indro-fl-mailbox', capability: 'fl.plugin.parameter' },
    authorization: { required: 'explicit-user-write' },
    preconditions: ['live bridge session', 'unique plugin identity', 'unique parameter identity', 'normalized value'],
    postcondition: { comparator: 'absolute-difference', tolerance: 0.002, observation: 'plugins.getParamValue' },
    verification: { required: 'host-readback', external_effect: 'not-established' },
    dependencies: {
      bridge_schema: session.schema,
      bridge_version: session.bridge_version,
      adapter: fileIdentity(adapterPath()),
      installed_bridge: fileIdentity(bridgePath(mailbox)),
    },
    evidence: [{ receipt: resolve(path), sha256: fileIdentity(path).sha256 }],
    invalidation: ['wrong application', 'bridge schema/version mismatch', 'adapter bytes changed', 'installed bridge bytes changed', 'plugin or parameter identity not uniquely resolvable'],
    limitations: ['checksum integrity is not authenticated provenance', 'host state only; audible effect not established'],
    reuse_eligibility: 'validate-before-each-invocation',
    retained_at: new Date().toISOString(),
  };
  const directory = join(capabilityRoot(options), id);
  mkdirSync(directory, { recursive: true });
  const destination = join(directory, `${payload.retained_at.replace(/[:.]/g, '-')}-${randomUUID()}.json`);
  writeFileSync(destination, `${JSON.stringify(envelope(payload), null, 2)}\n`, { flag: 'wx' });
  return { capability: payload, path: destination, sha256: fileIdentity(destination).sha256 };
}

export function retainPaintResizeCapability({ artifactPath, width, height, appVersion, ...options } = {}) {
  if (!artifactPath) throw new Error('ARTIFACT_PATH_REQUIRED');
  if (!Number.isInteger(width) || width < 1 || !Number.isInteger(height) || height < 1) throw new Error('INVALID_EXPECTED_DIMENSIONS');
  if (!appVersion) throw new Error('PAINT_VERSION_REQUIRED');
  const check = verifyPng(artifactPath, { width, height });
  if (!check.valid) throw new Error(`SOURCE_ARTIFACT_INVALID:${check.issues.join(',')}`);
  const payload = {
    schema: CAPABILITY_SCHEMA,
    schema_version: 1,
    id: 'paint.canvas.resize-and-export-png',
    goal: 'Resize a disposable Microsoft Paint canvas and export a PNG',
    parameters: {
      width: { type: 'integer', minimum: 1, maximum: 99999 },
      height: { type: 'integer', minimum: 1, maximum: 99999 },
      output: { type: 'new-local-file' },
    },
    target: {
      application: 'microsoft-paint', app_version: appVersion,
      identity_validation: 'installed package version plus live accessibility window title',
    },
    invocation: { adapter: 'authorized-accessibility-agent', assurance: 'lower', autonomous_cli: false },
    authorization: { required: 'explicit-user-write', scope: 'disposable document and new output path' },
    preconditions: ['live Microsoft Paint identity revalidated', 'disposable document', 'new output path', 'explicit PNG export type'],
    postcondition: { observation: 'PNG signature and IHDR dimensions' },
    verification: { required: 'independent-artifact-readback', external_effect: 'artifact bytes established' },
    dependencies: { verifier: fileIdentity(paintVerifierPath()) },
    evidence: [{ artifact: check.artifact.path, sha256: check.artifact.sha256, bytes: check.artifact.bytes, width, height }],
    invalidation: ['application version mismatch', 'verifier bytes changed', 'evidence missing or changed', 'accessibility recipe no longer resolves uniquely'],
    limitations: ['agent-mediated UI invocation', 'checksum integrity is not authenticated provenance'],
    reuse_eligibility: 'validate-live-identity-before-agent-mediated-invocation',
    retained_at: new Date().toISOString(),
  };
  const directory = join(capabilityRoot(options), payload.id);
  mkdirSync(directory, { recursive: true });
  const destination = join(directory, `${payload.retained_at.replace(/[:.]/g, '-')}-${randomUUID()}.json`);
  writeFileSync(destination, `${JSON.stringify(envelope(payload), null, 2)}\n`, { flag: 'wx' });
  return { capability: payload, path: destination, sha256: fileIdentity(destination).sha256 };
}

function validatePaintCapability(record, options) {
  const issues = [];
  if (record.target.application !== 'microsoft-paint') issues.push('WRONG_APPLICATION_IDENTITY');
  if (!options.paintAppVersion) issues.push('PAINT_IDENTITY_UNVERIFIED');
  else if (options.paintAppVersion !== record.target.app_version) issues.push('PAINT_VERSION_MISMATCH');
  try {
    if (record.dependencies.verifier.sha256 !== fileIdentity(paintVerifierPath()).sha256) issues.push('VERIFIER_FINGERPRINT_MISMATCH');
  } catch { issues.push('VERIFIER_UNAVAILABLE'); }
  const evidence = record.evidence?.[0];
  if (!evidence?.artifact) issues.push('EVIDENCE_MISSING');
  else {
    const check = verifyPng(evidence.artifact, { width: evidence.width, height: evidence.height, sha256: evidence.sha256 });
    issues.push(...check.issues.map(issue => `EVIDENCE_${issue}`));
  }
  return { valid: issues.length === 0, reusable: issues.length === 0, issues, capability: record,
    invocation: { autonomous: false, requires: 'authorized-accessibility-agent' } };
}

async function requestResult(transport, operation, args = {}, target = {}) {
  const value = await transport.request(operation, { arguments: args, target, authorization: 'read-only' });
  if (value.response.error) throw new Error(value.response.error);
  return value.response.result;
}

export async function validateCapability(id, options = {}) {
  const record = loadCapability(id, options);
  if (record.target.application === 'microsoft-paint') return validatePaintCapability(record, options);
  const issues = [];
  let session;
  try { session = (options.discoverSession ?? discoverSession)({ mailbox: options.mailbox ?? defaultMailbox() }); }
  catch (error) { return { valid: false, reusable: false, issues: [error.message], capability: record }; }
  if (record.target.application !== 'fl-studio') issues.push('WRONG_APPLICATION_IDENTITY');
  if (record.dependencies.bridge_schema !== session.schema || record.dependencies.bridge_version !== session.bridge_version) issues.push('BRIDGE_VERSION_MISMATCH');
  for (const [name, currentPath] of [['adapter', adapterPath()], ['installed_bridge', bridgePath(options.mailbox ?? defaultMailbox())]]) {
    try { if (record.dependencies[name].sha256 !== fileIdentity(currentPath).sha256) issues.push(`${name.toUpperCase()}_FINGERPRINT_MISMATCH`); }
    catch { issues.push(`${name.toUpperCase()}_UNAVAILABLE`); }
  }
  if (issues.length) return { valid: false, reusable: false, issues, capability: record };
  const transport = options.transport ?? createFlTransport(options);
  const status = await requestResult(transport, 'status');
  const selected = status.selected?.channel;
  const plugins = (await requestResult(transport, 'plugins.list', { channel: selected }, { channel: selected })).plugins
    .filter(item => item.plugin_name?.toLowerCase() === record.target.plugin_name.toLowerCase());
  const matches = [];
  for (const plugin of plugins) {
    const params = await requestResult(transport, 'plugin.params', { channel: plugin.channel }, plugin);
    for (const parameter of params.parameters.filter(item => item.name === record.target.parameter_name)) {
      matches.push({ channel: plugin.channel, parameter: parameter.index, plugin_name: plugin.plugin_name, parameter_name: parameter.name });
    }
  }
  if (matches.length !== 1) issues.push(matches.length ? 'TARGET_IDENTITY_AMBIGUOUS' : 'TARGET_IDENTITY_NOT_FOUND');
  return { valid: issues.length === 0, reusable: issues.length === 0, issues, capability: record, resolved_target: matches[0] ?? null,
    mapping_changed: matches.length === 1 && (matches[0].channel !== record.target.observed_mapping.channel || matches[0].parameter !== record.target.observed_mapping.parameter),
    validation_snapshot: matches.length === 1 ? {
      app_id: 'fl-studio', session_id: session.session_id, process_id: session.process_id,
      channel: matches[0].channel, plugin_name: matches[0].plugin_name,
      parameter: matches[0].parameter, parameter_name: matches[0].parameter_name,
      scope: 'single-fl-parameter-invocation', created_unix_ms: Date.now(),
    } : null };
}

export async function invokeCapability(id, value, options = {}) {
  if (options.authorization !== 'explicit-user-write') throw new Error('CAPABILITY_WRITE_NOT_AUTHORIZED');
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error('VALUE_OUT_OF_RANGE');
  const validation = await validateCapability(id, options);
  if (!validation.reusable) throw new Error(`CAPABILITY_NOT_REUSABLE:${validation.issues.join(',')}`);
  const output = [];
  const invocationOptions = options.validationSnapshot === true
    ? { ...options, validationSnapshot: validation.validation_snapshot }
    : options;
  const code = await (options.runFlCli ?? runFlCli)([
    'plugin', 'set', '--channel', String(validation.resolved_target.channel), '--param', String(validation.resolved_target.parameter),
    '--value', String(value), '--verify', '--json'
  ], line => output.push(line), line => output.push(line), invocationOptions);
  const result = output.length ? JSON.parse(output.at(-1)) : null;
  return { code, validation, result };
}
