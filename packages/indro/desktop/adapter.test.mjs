import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { assignWindowsOwner, createDesktopTransport, desktopWorkerStatus, DESKTOP_SCHEMA } from './adapter.mjs';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'indro-desktop-mailbox-'));
  writeFileSync(join(root, 'worker.json'), JSON.stringify({
    schema: DESKTOP_SCHEMA, pid: process.pid, session_id: 1, heartbeat_at: new Date().toISOString(),
  }));
  return root;
}

test('desktop transport accepts only an identity-matched response from a fresh worker', async () => {
  const root = fixture();
  const transport = createDesktopTransport({ root, publishRequest: (path, value) => {
    mkdirSync(join(root, 'requests'), { recursive: true });
    writeFileSync(path, JSON.stringify(value));
  }, trigger: async ({ request, requestPath, responsePath }) => {
    assert.deepEqual(JSON.parse(readFileSync(requestPath, 'utf8')), request);
    mkdirSync(join(root, 'responses'), { recursive: true });
    writeFileSync(responsePath, JSON.stringify({
      schema: DESKTOP_SCHEMA, request_id: request.request_id, ok: true,
      result: { observation: { value: false } }, worker: { pid: process.pid, session_id: 1 },
    }));
  } });
  const exchange = await transport.request('fl-studio.browser.observe', {});
  assert.equal(exchange.response.result.observation.value, false);
  assert.equal(exchange.request.authorization.scope, 'fl-studio.browser.observe');
});

test('request owner assignment is SID-bound and requires exact readback', () => {
  const calls = [];
  const run = (file, args, options) => {
    calls.push({ file, args, options });
    return { status: 0, stdout: `${options.env.INDRO_DESKTOP_OWNER_SID}\n`, stderr: '' };
  };
  assert.equal(assignWindowsOwner('request.tmp', 'S-1-5-21-1-2-3-1001', { run }), 'S-1-5-21-1-2-3-1001');
  assert.equal(calls[0].file, 'powershell.exe');
  assert.match(calls[0].options.env.INDRO_DESKTOP_REQUEST_PATH, /request\.tmp$/);
  assert.throws(() => assignWindowsOwner('request.tmp', 'Administrators', { run }), /OWNER_SID_INVALID/);
  assert.throws(() => assignWindowsOwner('request.tmp', 'S-1-5-21-1-2-3-1001', {
    run: () => ({ status: 0, stdout: 'S-1-5-18\n', stderr: '' }),
  }), /OWNER_VERIFICATION_FAILED/);
});

test('stale or missing desktop worker fails closed before creating a request', async () => {
  const root = fixture();
  const stale = desktopWorkerStatus({ root, now: Date.now() + 10_000, maxAgeMs: 1000 });
  assert.equal(stale.ready, false);
  assert.equal(stale.reason, 'WORKER_STALE');
  const transport = createDesktopTransport({ root: join(root, 'absent') });
  await assert.rejects(() => transport.request('fl-studio.browser.observe', {}), /WORKER_UNAVAILABLE/);
});

