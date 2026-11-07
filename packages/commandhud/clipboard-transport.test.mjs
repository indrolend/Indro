import test from 'node:test';
import assert from 'node:assert/strict';
import {
  encodeOsc52, selectClipboardTransport, validateClipboardPayload, writeClipboard,
} from './clipboard-transport.mjs';

test('SSH TTY selects OSC 52', () => {
  assert.equal(selectClipboardTransport({
    platform: 'win32', env: { SSH_CONNECTION: 'remote' }, isTTY: true,
  }), 'osc52');
});
test('non-TTY SSH retains native transport', () => {
  assert.equal(selectClipboardTransport({
    platform: 'win32', env: { SSH_CONNECTION: 'remote' }, isTTY: false,
  }), 'windows');
});
test('local Windows retains native transport', () => {
  assert.equal(selectClipboardTransport({
    platform: 'win32', env: {}, isTTY: true,
  }), 'windows');
});
test('explicit transport override wins and invalid values fail closed', () => {
  assert.equal(selectClipboardTransport({
    platform: 'win32', env: { SSH_CONNECTION: 'remote' }, isTTY: true, requested: 'native',
  }), 'windows');
  assert.equal(selectClipboardTransport({
    platform: 'linux', env: {}, isTTY: true, requested: 'osc52',
  }), 'osc52');
  assert.throws(() => selectClipboardTransport({ requested: 'magic' }), /Unsupported/);
  assert.throws(() => selectClipboardTransport({ requested: 'osc52', isTTY: false }), /interactive terminal/);
});
test('nested and dumb SSH terminals do not auto-emit OSC 52', () => {
  assert.equal(selectClipboardTransport({
    platform: 'linux', env: { SSH_CONNECTION: 'remote', TMUX: '/tmp/tmux' }, isTTY: true,
  }), 'linux');
  assert.equal(selectClipboardTransport({
    platform: 'linux', env: { SSH_CONNECTION: 'remote', TERM: 'dumb' }, isTTY: true,
  }), 'linux');
});
test('OSC 52 encodes multiline Unicode exactly', () => {
  const value = 'INDRO\nΔ evidence';
  assert.equal(encodeOsc52(value),
    `\x1b]52;c;${Buffer.from(value).toString('base64')}\x07`);
  assert.equal(encodeOsc52(value, { terminator: 'st' }),
    `\x1b]52;c;${Buffer.from(value).toString('base64')}\x1b\\`);
});
test('empty and oversized content is rejected', () => {
  assert.throws(() => encodeOsc52(''), /empty/);
  assert.throws(() => encodeOsc52('x'.repeat(32769)), /32768/);
  assert.equal(validateClipboardPayload('Δ'.repeat(16384)).bytes.length, 32768);
  assert.throws(() => validateClipboardPayload(`Δ${'x'.repeat(32767)}`), /32768/);
});
test('OSC 52 writes to the interactive terminal', () => {
  let written = '';
  const delivery = writeClipboard('packet', {
    transport: 'osc52',
    output: { isTTY: true, write: value => { written += value; } },
  });
  assert.equal(written, encodeOsc52('packet'));
  assert.deepEqual(delivery, { transport: 'osc52', state: 'sent', acknowledged: false, bytes: 6 });
});
test('Windows transport preserves UTF-16LE', () => {
  let received;
  const delivery = writeClipboard('INDRO', {
    transport: 'windows',
    spawn: (_command, _args, options) => {
      received = options.input;
      return { status: 0 };
    },
  });
  assert.equal(received.toString('utf16le'), 'INDRO');
  assert.deepEqual(delivery, { transport: 'windows', state: 'copied', acknowledged: true, bytes: 5 });
});
test('transport failures and OSC non-TTY use explicit errors', () => {
  assert.throws(() => writeClipboard('packet', {
    transport: 'osc52', output: { isTTY: false, write() {} },
  }), /interactive terminal/);
  assert.throws(() => writeClipboard('packet', {
    transport: 'linux', spawn: () => ({ status: 1 }),
  }), /unavailable/);
  assert.throws(() => writeClipboard('packet', {
    transport: 'linux', spawn: () => ({ status: null, error: new Error('missing') }),
  }), /unavailable/);
});
