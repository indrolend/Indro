import { spawnSync } from 'node:child_process';

export const MAX_CLIPBOARD_BYTES = 32768;
export const CLIPBOARD_TRANSPORT_ENV = 'COMMANDHUD_CLIPBOARD_TRANSPORT';

const NATIVE_TRANSPORT = { win32: 'windows', darwin: 'macos' };

function nativeTransport(platform) {
  return NATIVE_TRANSPORT[platform] || 'linux';
}

export function selectClipboardTransport({
  platform = process.platform,
  env = process.env,
  isTTY = process.stdout.isTTY,
  requested = env[CLIPBOARD_TRANSPORT_ENV] || 'auto',
} = {}) {
  const normalized = String(requested).toLowerCase();
  const allowed = new Set(['auto', 'native', 'osc52', 'windows', 'macos', 'linux']);
  if (!allowed.has(normalized)) throw new Error(`Unsupported clipboard transport: ${requested}`);
  if (normalized === 'osc52') {
    if (!isTTY) throw new Error('OSC 52 requires an interactive terminal.');
    return 'osc52';
  }
  if (normalized !== 'auto' && normalized !== 'native') return normalized;
  if (normalized === 'native') return nativeTransport(platform);
  const ssh = Boolean(env.SSH_CONNECTION || env.SSH_CLIENT || env.SSH_TTY);
  const nestedTerminal = Boolean(env.TMUX || env.STY);
  if (ssh && isTTY && !nestedTerminal && env.TERM !== 'dumb') return 'osc52';
  return nativeTransport(platform);
}

export function validateClipboardPayload(text, maximumBytes = MAX_CLIPBOARD_BYTES) {
  const value = String(text);
  const bytes = Buffer.from(value, 'utf8');
  if (!bytes.length) throw new Error('Clipboard content is empty.');
  if (bytes.length > maximumBytes) {
    throw new Error(`Clipboard content exceeds ${maximumBytes} UTF-8 bytes.`);
  }
  return { value, bytes };
}

export function encodeOsc52(text, { terminator = 'bel' } = {}) {
  const { bytes } = validateClipboardPayload(text);
  if (!['bel', 'st'].includes(terminator)) throw new Error(`Unsupported OSC 52 terminator: ${terminator}`);
  const end = terminator === 'st' ? '\x1b\\' : '\x07';
  return `\x1b]52;c;${bytes.toString('base64')}${end}`;
}

export function encodeNativeClipboardInput(text, transport) {
  const { value } = validateClipboardPayload(text);
  return transport === 'windows' ? Buffer.from(value, 'utf16le') : value;
}

export function writeClipboard(text, {
  output = process.stdout,
  spawn = spawnSync,
  platform = process.platform,
  env = process.env,
  transport = selectClipboardTransport({ platform, env, isTTY: output.isTTY }),
  terminator = 'bel',
} = {}) {
  const { value, bytes } = validateClipboardPayload(text);
  if (transport === 'osc52') {
    if (!output.isTTY) throw new Error('OSC 52 requires an interactive terminal.');
    output.write(encodeOsc52(value, { terminator }));
    return { transport, state: 'sent', acknowledged: false, bytes: bytes.length };
  }
  const tool = transport === 'windows' ? ['clip.exe', []]
    : transport === 'macos' ? ['pbcopy', []]
    : transport === 'linux'
      ? ['sh', ['-c', 'command -v wl-copy >/dev/null && wl-copy || xclip -selection clipboard']]
      : null;
  if (!tool) throw new Error(`Unsupported clipboard transport: ${transport}`);
  const input = encodeNativeClipboardInput(value, transport);
  const result = spawn(tool[0], tool[1], { input, windowsHide: true });
  if (result.error || result.status !== 0) {
    throw new Error('Clipboard tool is unavailable.');
  }
  return { transport, state: 'copied', acknowledged: true, bytes: bytes.length };
}
