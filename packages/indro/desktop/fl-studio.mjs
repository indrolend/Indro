import { executeTransaction } from '../uai/transaction.mjs';
import { persistFlReceipt } from '../fl/adapter.mjs';
import { createDesktopTransport } from './adapter.mjs';

function responseValue(exchange) {
  if (!exchange.response.ok) {
    const error = new Error(exchange.response.error || 'DESKTOP_OPERATION_FAILED');
    error.transactionId = exchange.response.request_id;
    throw error;
  }
  return exchange.response.result;
}

export function createFlBrowserAdapter({ transport = createDesktopTransport() } = {}) {
  return {
    name: transport.name,
    async observe(target, capabilityId) {
      if (target.app_id !== 'fl-studio' || capabilityId !== 'fl.browser.visibility') throw new Error('TARGET_OR_CAPABILITY_INVALID');
      const result = responseValue(await transport.request('fl-studio.browser.observe', {}));
      if (result.observation.application.process_id !== target.process_id
        || result.observation.application.executable_sha256 !== target.executable_sha256) {
        throw new Error('TARGET_IDENTITY_CHANGED');
      }
      return result.observation;
    },
    async invoke(target, capability, args) {
      if (target.app_id !== 'fl-studio' || capability.id !== 'fl.browser.visibility') return { error: 'TARGET_OR_CAPABILITY_INVALID' };
      const exchange = await transport.request('fl-studio.browser.set', { value: args.value });
      if (!exchange.response.ok && exchange.response.outcome_unknown === true) {
        const error = new Error(exchange.response.error || 'DESKTOP_MUTATION_OUTCOME_UNKNOWN');
        error.transactionId = exchange.response.request_id;
        throw error;
      }
      if (!exchange.response.ok) return { error: exchange.response.error, milestones: { RECEIVED: true } };
      const result = exchange.response.result;
      if (result.after?.application?.process_id !== target.process_id
        || result.after?.application?.executable_sha256 !== target.executable_sha256) {
        return { error: 'TARGET_IDENTITY_CHANGED', milestones: { RECEIVED: true } };
      }
      return {
        milestones: { RECEIVED: true, ACCEPTED: true, EXECUTED: true },
        mutation_attempted: result.mutation_attempted,
        idempotent: result.idempotent,
        worker: exchange.response.worker,
      };
    },
  };
}

export async function observeFlBrowser({ transport = createDesktopTransport() } = {}) {
  const exchange = await transport.request('fl-studio.browser.observe', {});
  return { ...responseValue(exchange).observation, worker: exchange.response.worker };
}

export async function setFlBrowser(value, dependencies = {}) {
  const transport = dependencies.transport ?? createDesktopTransport(dependencies);
  const initial = await observeFlBrowser({ transport });
  const target = { app_id: 'fl-studio', ...initial.application };
  const adapter = dependencies.adapter ?? createFlBrowserAdapter({ transport });
  const transaction = await executeTransaction({
    target, capability: { id: 'fl.browser.visibility' }, args: { value },
    adapter, verify: 'readback', authorization: 'explicit-user-desktop-write',
  });
  const record = {
    producer: { owner: 'INDRO', adapter: adapter.name, desktop_schema: 'indro.desktop-control.v1' },
    trust_model: 'Keyboard command delivery with independent Win32 visibility readback; audible effect not established',
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
    observation: { execution: 'pywinauto keyboard Alt+F8', verification: 'Win32 IsWindowVisible on TSampleListForm' },
  };
  const evidence = (dependencies.persistReceipt ?? persistFlReceipt)(record, dependencies);
  return { ...record, evidence };
}

