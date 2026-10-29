import { executeTransaction } from '../uai/transaction.mjs';
import {
  createFlAdapter, createFlTransport, discoverSession, latestFlReceipt,
  persistFlReceipt, validateFlReceipt
} from './adapter.mjs';

const USAGE = `indro fl doctor --json
indro fl status --json
indro fl channels list --json
indro fl plugins list --json
indro fl plugin inspect --channel N --json
indro fl plugin params --channel N --json
indro fl plugin get --channel N --param N --json
indro fl plugin set --channel N --param N --value 0..1 --verify --json
indro fl transport status --json
indro fl verify --latest --json`;

function parse(argv) {
  const positional = [];
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith('--')) { positional.push(value); continue; }
    const name = value.slice(2);
    if (['json', 'verify', 'latest'].includes(name)) { options[name] = true; continue; }
    if (!['channel', 'param', 'value', 'seconds'].includes(name) || index + 1 >= argv.length) {
      throw new Error(`UNKNOWN_OR_INCOMPLETE_OPTION:${value}`);
    }
    if (Object.hasOwn(options, name)) throw new Error(`DUPLICATE_OPTION:${value}`);
    options[name] = argv[++index];
  }
  return { positional, options };
}

function integer(value, name) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`INVALID_${name.toUpperCase()}`);
  return parsed;
}

function normalized(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) throw new Error('VALUE_OUT_OF_RANGE');
  return parsed;
}

async function hostRequest(transport, operation, args = {}, target = {}) {
  const result = await transport.request(operation, { arguments: args, target });
  if (result.response.error) throw new Error(result.response.error);
  return result.response.result;
}

async function pluginIdentity(transport, session, channel) {
  const value = await hostRequest(transport, 'plugin.inspect', { channel }, { channel });
  if (!value.plugin_valid) throw new Error('NO_PLUGIN');
  return {
    app_id: 'fl-studio', session_id: session.session_id, process_id: session.process_id,
    channel, channel_name: value.channel_name, plugin_name: value.plugin_name
  };
}

function validatedPluginIdentity(session, channel, snapshot) {
  if (!snapshot) return null;
  if (snapshot.session_id !== session.session_id || snapshot.process_id !== session.process_id) throw new Error('VALIDATION_SNAPSHOT_STALE');
  if (snapshot.channel !== channel || snapshot.app_id !== 'fl-studio' || !snapshot.plugin_name) throw new Error('VALIDATION_SNAPSHOT_SCOPE_MISMATCH');
  return snapshot;
}

export async function runFlCli(argv, out = console.log, err = console.error, dependencies = {}) {
  let parsed;
  try { parsed = parse(argv); } catch (error) { err(`INDRO_ERROR ${error.message}`); return 2; }
  const { positional: words, options } = parsed;
  if (!words.length || words[0] === 'help') { out(USAGE); return 0; }
  if (!options.json) { err('INDRO_ERROR --json is required for the FL interface'); return 2; }
  const transport = dependencies.transport ?? createFlTransport(dependencies);
  const getSession = dependencies.discoverSession ?? (() => discoverSession(dependencies));
  try {
    if (words[0] === 'doctor' && words.length === 1) {
      const session = getSession();
      const status = await hostRequest(transport, 'ping');
      out(JSON.stringify({ connected: true, session, status, write_mode: 'per-command-explicit', authority: 'FL Studio scripting API' }, null, 2));
      return 0;
    }
    const session = getSession();
    if (words[0] === 'status' && words.length === 1) {
      out(JSON.stringify(await hostRequest(transport, 'status'), null, 2)); return 0;
    }
    if (words[0] === 'channels' && words[1] === 'list' && words.length === 2) {
      out(JSON.stringify(await hostRequest(transport, 'channels.list'), null, 2)); return 0;
    }
    if (words[0] === 'plugins' && words[1] === 'list' && words.length === 2) {
      const status = await hostRequest(transport, 'status');
      const selected = status.selected?.channel;
      out(JSON.stringify(await hostRequest(transport, 'plugins.list', { channel: selected }, { channel: selected }), null, 2)); return 0;
    }
    if (words[0] === 'transport' && words[1] === 'status' && words.length === 2) {
      out(JSON.stringify(await hostRequest(transport, 'transport.status'), null, 2)); return 0;
    }
    if (words[0] === 'verify' && words.length === 1 && options.latest) {
      const path = (dependencies.latestReceipt ?? latestFlReceipt)(dependencies);
      const result = validateFlReceipt(path, { expectedSession: session.session_id });
      out(JSON.stringify({ receipt: path, ...result }, null, 2)); return result.valid ? 0 : 1;
    }
    if (words[0] !== 'plugin' || !['inspect', 'params', 'get', 'set'].includes(words[1]) || words.length !== 2) {
      throw new Error('UNSUPPORTED_FL_COMMAND');
    }
    const channel = integer(options.channel, 'channel');
    const target = validatedPluginIdentity(session, channel, dependencies.validationSnapshot)
      ?? await pluginIdentity(transport, session, channel);
    if (words[1] === 'inspect') {
      out(JSON.stringify(await hostRequest(transport, 'plugin.inspect', { channel }, target), null, 2)); return 0;
    }
    if (words[1] === 'params') {
      out(JSON.stringify(await hostRequest(transport, 'plugin.params', { channel }, target), null, 2)); return 0;
    }
    const parameter = integer(options.param, 'parameter');
    const parameterTarget = {
      ...target, parameter,
      ...(dependencies.expectedParameterName ? { parameter_name: dependencies.expectedParameterName } : {}),
    };
    if (words[1] === 'get') {
      out(JSON.stringify(await hostRequest(transport, 'plugin.get', { channel, parameter }, parameterTarget), null, 2)); return 0;
    }
    if (!options.verify) throw new Error('WRITE_REQUIRES_VERIFY');
    const value = normalized(options.value);
    const adapter = dependencies.adapter ?? createFlAdapter({ ...dependencies, transport });
    const transaction = await executeTransaction({
      target: parameterTarget,
      capability: { id: 'fl.plugin.parameter' },
      args: { value }, adapter, verify: 'readback', tolerance: 0.002,
      authorization: 'explicit-user-write'
    });
    const record = {
      producer: { owner: 'INDRO', adapter: adapter.name, bridge_schema: 'indro.fl.bridge.v1' },
      trust_model: 'FL Studio scripting API host readback; audible effect not established',
      transaction,
      claims: {
        command_submitted: transaction.milestones.SUBMITTED,
        command_received: transaction.milestones.RECEIVED,
        command_accepted: transaction.milestones.ACCEPTED,
        execution_reported: transaction.milestones.EXECUTED,
        postcondition_confirmed: transaction.milestones.STATE_CONFIRMED,
        state_transition_observed: transaction.state_transition_observed ?? false,
        external_effect_independently_verified: false,
      },
      comparator: { kind: 'absolute-difference', tolerance: 0.002 },
    };
    const evidence = (dependencies.persistReceipt ?? persistFlReceipt)(record, dependencies);
    out(JSON.stringify({ ...record, evidence }, null, 2));
    return transaction.verdict === 'STATE_CONFIRMED' ? 0 : 1;
  } catch (error) {
    out(JSON.stringify({ connected: false, error: error?.message ?? String(error), transaction_id: error?.transactionId ?? null }, null, 2));
    return 1;
  }
}
