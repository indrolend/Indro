import { spawnSync } from 'node:child_process';

export const MAX_CLIPBOARD_BYTES = 32 * 1024;

export function encodeOsc52(text) {
  const bytes = Buffer.from(String(text), 'utf8');
  if (!bytes.length) throw new Error('Clipboard payload is empty.');
  if (bytes.length > MAX_CLIPBOARD_BYTES) throw new Error('Clipboard payload exceeds 32768 bytes.');
  return `\x1b]52;c;${bytes.toString('base64')}\x07`;
}

export function selectClipboardTransport({
  platform = process.platform, env = process.env, isTTY = process.stdout.isTTY,
} = {}) {
  // Explicit opt-in: terminal clipboard writes can overwrite a local user's clipboard.
  if (env.HUD_OSC52 === '1' && env.SSH_CONNECTION && isTTY) return 'osc52';
  if (platform === 'win32') return 'windows';
  if (platform === 'darwin') return 'macos';
  return 'linux';
}

export function writeClipboard(text, {
  transport = selectClipboardTransport(), output = process.stdout, spawn = spawnSync,
} = {}) {
  const value = String(text);
  const bytes = Buffer.from(value, 'utf8');
  if (!bytes.length) throw new Error('Clipboard payload is empty.');
  if (bytes.length > MAX_CLIPBOARD_BYTES) throw new Error('Clipboard payload exceeds 32768 bytes.');
  if (transport === 'osc52') {
    if (!output.isTTY) throw new Error('OSC 52 requires an interactive terminal.');
    output.write(encodeOsc52(value));
    return { transport, sent: true, confirmed: false };
  }
  const command = transport === 'windows' ? ['clip.exe', []]
    : transport === 'macos' ? ['pbcopy', []]
      : transport === 'linux'
        ? ['sh', ['-c', 'if command -v wl-copy >/dev/null; then wl-copy; else xclip -selection clipboard; fi']]
        : null;
  if (!command) throw new Error(`Unsupported clipboard transport: ${transport}`);
  const result = spawn(command[0], command[1], {
    input: transport === 'windows' ? Buffer.from(value, 'utf16le') : value,
    windowsHide: true,
  });
  if (result.error || result.status !== 0) throw new Error('Clipboard tool is unavailable.');
  return { transport, sent: true, confirmed: true };
}
