import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeOsc52, selectClipboardTransport, writeClipboard } from './clipboard-transport.mjs';

test('OSC 52 requires explicit SSH TTY opt-in', () => {
  assert.equal(selectClipboardTransport({ platform: 'win32', env: { SSH_CONNECTION: 'x' }, isTTY: true }), 'windows');
  assert.equal(selectClipboardTransport({ platform: 'win32', env: { SSH_CONNECTION: 'x', HUD_OSC52: '1' }, isTTY: true }), 'osc52');
  assert.equal(selectClipboardTransport({ platform: 'win32', env: { SSH_CONNECTION: 'x', HUD_OSC52: '1' }, isTTY: false }), 'windows');
  assert.equal(selectClipboardTransport({ platform: 'win32', env: { HUD_OSC52: '1' }, isTTY: true }), 'windows');
});

test('OSC 52 encodes Unicode and multiline text exactly', () => {
  const text = 'INDRO\nΔ\r\n';
  assert.equal(encodeOsc52(text), `\x1b]52;c;${Buffer.from(text).toString('base64')}\x07`);
});

test('reject empty and oversized packets', () => {
  assert.throws(() => encodeOsc52(''), /empty/);
  assert.throws(() => encodeOsc52('x'.repeat(32769)), /32768/);
  assert.throws(() => writeClipboard(''), /empty/);
});

test('OSC 52 sends but does not claim clipboard receipt', () => {
  let emitted = '';
  const result = writeClipboard('packet', {
    transport: 'osc52', output: { isTTY: true, write: text => { emitted += text; } },
  });
  assert.equal(emitted, encodeOsc52('packet'));
  assert.deepEqual(result, { transport: 'osc52', sent: true, confirmed: false });
});

test('OSC 52 refuses non-TTY output', () => {
  assert.throws(() => writeClipboard('packet', {
    transport: 'osc52', output: { isTTY: false, write() { throw new Error('should not run'); } },
  }), /interactive terminal/);
});

test('native Windows clipboard receives UTF-16LE input', () => {
  let command;
  let input;
  const result = writeClipboard('INDRO Δ', {
    transport: 'windows',
    spawn: (name, args, options) => {
      command = name; input = options.input;
      return { status: 0 };
    },
  });
  assert.equal(command, 'clip.exe');
  assert.equal(input.toString('utf16le'), 'INDRO Δ');
  assert.equal(result.confirmed, true);
});
