import assert from 'node:assert/strict';
import test from 'node:test';
import { setFlBrowser } from './fl-studio.mjs';
import { runAppCli } from '../uai/cli.mjs';

function fixture(initial = false) {
  let state = initial;
  let mutations = 0;
  const identity = {
    app_id: 'fl-studio', process_id: 42, process_start: 1,
    executable: 'FL64.exe', executable_sha256: 'a'.repeat(64), session_id: 1,
    main_handle: 10, main_class: 'TFruityLoopsMainForm',
    browser_handle: 11, browser_class: 'TSampleListForm',
  };
  const observation = () => ({ value: state, application: identity, main_enabled: true, observation_source: 'Win32' });
  const transport = {
    name: 'fixture-desktop-mailbox',
    async request(operation, args) {
      if (operation.endsWith('.observe')) return { response: { ok: true, result: { observation: observation() }, worker: { pid: 7, session_id: 1 } } };
      const before = observation();
      if (state !== args.value) { state = args.value; mutations += 1; }
      return { response: { ok: true, result: { before, after: observation(), mutation_attempted: before.value !== state, idempotent: before.value === state }, worker: { pid: 7, session_id: 1 } } };
    },
  };
  return { transport, mutations: () => mutations, state: () => state };
}

test('FL Browser state setting verifies changed state and retains existing FL receipt shape', async () => {
  const f = fixture(false);
  const result = await setFlBrowser(true, {
    transport: f.transport, persistReceipt: record => ({ path: 'receipt.json', sha256: 'b'.repeat(64), verdict: record.transaction.verdict }),
  });
  assert.equal(result.transaction.verdict, 'STATE_CONFIRMED');
  assert.equal(result.transaction.state_transition_observed, true);
  assert.equal(result.claims.external_effect_independently_verified, false);
  assert.equal(f.state(), true);
  assert.equal(f.mutations(), 1);
  assert.equal(result.evidence.path, 'receipt.json');
});

test('FL Browser state setting is idempotent and does not invent a transition', async () => {
  const f = fixture(false);
  const result = await setFlBrowser(false, { transport: f.transport, persistReceipt: () => ({ path: 'receipt.json' }) });
  assert.equal(result.transaction.verdict, 'STATE_CONFIRMED');
  assert.equal(result.transaction.state_transition_observed, false);
  assert.equal(f.mutations(), 0);
});

test('application CLI exposes the same bounded adapter to terminal callers', async () => {
  const f = fixture(false);
  const output = [];
  const code = await runAppCli(['fl-studio', 'browser', 'show', '--json'], value => output.push(value), () => {}, {
    transport: f.transport, persistReceipt: () => ({ path: 'receipt.json' }),
  });
  assert.equal(code, 0);
  assert.equal(JSON.parse(output[0]).transaction.verdict, 'STATE_CONFIRMED');
  assert.equal(f.state(), true);
});

test('post-mutation observation failure remains unknown and is never retried blindly', async () => {
  const f = fixture(false);
  let writes = 0;
  const transport = {
    ...f.transport,
    async request(operation, args) {
      if (operation.endsWith('.observe')) return f.transport.request(operation, args);
      writes += 1;
      return { response: {
        ok: false, outcome_unknown: true, request_id: 'uncertain-request',
        error: 'POST_MUTATION_OBSERVATION_FAILED:UIA_TIMEOUT', worker: { pid: 7, session_id: 1 },
      } };
    },
  };
  const result = await setFlBrowser(true, { transport, persistReceipt: () => ({ path: 'receipt.json' }) });
  assert.equal(result.transaction.verdict, 'TRANSPORT_UNKNOWN');
  assert.equal(result.transaction.milestones.STATE_CONFIRMED, 'UNKNOWN');
  assert.equal(writes, 1);
});

