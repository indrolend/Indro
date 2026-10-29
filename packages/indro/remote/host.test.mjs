import assert from 'node:assert/strict';
import test from 'node:test';
import { buildRemoteStatus, parseDxgi, parseSunshineLog, remoteRecoveryPlan } from './host.mjs';
import { runRemoteCli } from './cli.mjs';

const fixture = () => buildRemoteStatus({
  windows: { supported: true, service: { State: 'Running' }, sunshine: { Responding: true, SessionId: 1 }, fl: { Responding: true, SessionId: 1 } },
  dxgi: parseDxgi('Output Name : \\\\.\\DISPLAY1\nAttachedToDesktop : yes\nResolution : 2560x1440'),
  log: parseSunshineLog('Capture size : 2560x1440\nNvEnc: created encoder\nCLIENT CONNECTED\nCLIENT DISCONNECTED'),
  tailscale: { available: true, state: 'Running', addresses: ['100.64.0.1'] },
  executable: { exists: true, sha256: 'a'.repeat(64) }, config: { exists: true, bytes: 0, sha256: 'b'.repeat(64) },
});

test('remote status separates host readiness from client pixels and input', () => {
  const value = fixture();
  assert.equal(value.verdict, 'HOST_READY_END_TO_END_UNVERIFIED');
  assert.equal(value.claims.displayDetected, true);
  assert.equal(value.claims.captureInitialized, true);
  assert.equal(value.claims.encoderInitialized, true);
  assert.equal(value.claims.streamConnected, false);
  assert.equal(value.claims.validDesktopPixelsObservedByClient, null);
  assert.equal(value.claims.endToEndControlVerified, false);
});

test('recovery remains a non-mutating guarded plan', () => {
  const value = remoteRecoveryPlan(fixture());
  assert.equal(value.mutationPerformed, false);
  assert.equal(value.eligibleForSunshineOnlyRestart, true);
  assert.ok(value.forbidden.includes('Windows reboot'));
});

test('remote CLI rejects mutation and emits machine-readable status', async () => {
  const output = [];
  assert.equal(await runRemoteCli(['status', '--json'], { inspect: fixture, out: value => output.push(value) }), 0);
  assert.equal(output[0].verdict, 'HOST_READY_END_TO_END_UNVERIFIED');
  assert.equal(await runRemoteCli(['restart'], { inspect: fixture, error: () => {} }), 2);
});
