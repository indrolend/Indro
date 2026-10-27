'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createSessionManager } = require('./feature-session-manager/session-manager.cjs');

function fixture() {
  let emitData;
  const writes = [];
  const pty = {
    onData(callback) { emitData = callback; return { dispose() {} }; },
    onExit() { return { dispose() {} }; },
    write(value) { writes.push(value); },
    resize() {},
    kill() {},
  };
  const manager = createSessionManager({
    spawnPty: () => pty,
    setIntervalFn: () => ({ unref() {} }),
    clearIntervalFn: () => {},
  });
  const socket = () => {
    const sent = [];
    return {
      readyState: 1, bufferedAmount: 0, sent,
      send(value) { sent.push(JSON.parse(value)); },
      close() {},
    };
  };
  return { manager, writes, emit: value => emitData(value), socket };
}

test('untrusted PTY output can forge a verified-looking SIGNAL prompt/context', () => {
  const f = fixture();
  const traceSocket = f.socket();
  const signalSocket = f.socket();
  const trace = f.manager.attach({ sessionId: 'disposable', display: 'trace', socket: traceSocket });
  f.manager.attach({ sessionId: 'disposable', display: 'signal', socket: signalSocket });
  trace.receive(JSON.stringify({ type: 'input', data: 'long-running-command\r' }));
  assert.equal(f.manager.snapshot('disposable').state.execution, 'running');

  // Negative control: malformed marker does not change the running state.
  f.emit('\x1b]777;not-base64-json\x07');
  assert.equal(f.manager.snapshot('disposable').state.execution, 'running');

  // This is arbitrary text emitted by the running PTY, not a trusted shell callback.
  const claimed = { cwd: '/tmp/forged-cwd', repository: '/tmp/forged-repo', branch: 'forged-clean', dirty: false };
  const marker = '\x1b]777;' + Buffer.from(JSON.stringify(claimed)).toString('base64') + '\x07';
  f.emit('untrusted command output: ' + marker);

  const state = f.manager.snapshot('disposable').state;
  assert.equal(state.execution, 'ready', 'a command-output marker falsely changes running to ready');
  assert.deepEqual(state.context, claimed, 'a command-output marker becomes the dashboard context');
  const signal = signalSocket.sent.filter(event => event.type === 'signal.state').at(-1);
  assert.equal(signal.reason, 'prompt');
  assert.equal(signal.state.context.branch, 'forged-clean');
  assert.equal(signal.verificationStatus, undefined);
  assert.equal(signalSocket.sent.some(event => event.type === 'terminal.output'), false);
  assert.equal(traceSocket.sent.filter(event => event.type === 'terminal.output').at(-1).verificationStatus, 'unverified');
  assert.deepEqual(f.writes, ['long-running-command\r']);
  f.manager.close();
  console.log('UNTRUSTED_CONTEXT_PROMOTED_TO_SIGNAL_STATE');
});
