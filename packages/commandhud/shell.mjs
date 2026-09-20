import { spawnSync } from 'node:child_process';
import { basename, relative } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { PassThrough } from 'node:stream';
import {
  buildCurrentOperationContext, buildOperationContext, MAX_TERMINAL_INPUT_CHARACTERS,
} from './core.mjs';
export { parseShellEvidenceCommand, renderShellEvidenceProjection } from './shell-builtins.mjs';
export { shellInputIncomplete } from './execution-provider.mjs';
import { createShellSession } from './shell-session.mjs';
import { createShellVisualStatus, IDLE_FACE, visualMotionEnabled } from './shell-visual.mjs';
import { createShellLayout, splitMouseInput } from './shell-layout.mjs';

const PASTE_START = '\x1b[200~';
const PASTE_END = '\x1b[201~';
const COMPOSER_ESCAPE = '\uFDD0';

export function encodeComposerPaste(text) {
  return String(text).replaceAll(COMPOSER_ESCAPE, `${COMPOSER_ESCAPE}e`)
    .replaceAll('\r\n', `${COMPOSER_ESCAPE}n`)
    .replaceAll('\r', `${COMPOSER_ESCAPE}r`)
    .replaceAll('\n', `${COMPOSER_ESCAPE}l`);
}

export function decodeComposerText(text) {
  return String(text).replace(new RegExp(`${COMPOSER_ESCAPE}([enrl])`, 'g'), (_, code) => (
    code === 'e' ? COMPOSER_ESCAPE : code === 'n' ? '\r\n' : code === 'r' ? '\r' : '\n'
  ));
}

function possibleSequencePrefix(value, sequence) {
  for (let length = Math.min(value.length, sequence.length - 1); length > 0; length--) {
    if (sequence.startsWith(value.slice(-length))) return length;
  }
  return 0;
}

export function createBracketedPasteDecoder({ writeText, writePaste }) {
  let pending = '';
  let pasting = false;
  const emitAvailable = () => {
    while (pending) {
      const boundary = pasting ? PASTE_END : PASTE_START;
      const index = pending.indexOf(boundary);
      if (index >= 0) {
        const value = pending.slice(0, index);
        if (value) (pasting ? writePaste : writeText)(value);
        pending = pending.slice(index + boundary.length);
        pasting = !pasting;
        continue;
      }
      const retained = possibleSequencePrefix(pending, boundary);
      if (!pasting && pending === '\x1b') {
        writeText(pending);
        pending = '';
        break;
      }
      const value = pending.slice(0, pending.length - retained);
      if (value) (pasting ? writePaste : writeText)(value);
      pending = pending.slice(pending.length - retained);
      break;
    }
  };
  return {
    push(value) { pending += Buffer.isBuffer(value) ? value.toString('utf8') : String(value); emitAvailable(); },
    flush() { if (pending) (pasting ? writePaste : writeText)(pending); pending = ''; },
    get pasting() { return pasting; },
  };
}

export function createTuiReadlineOutput(output, enabled = true) {
  if (!enabled) return output;
  return new Proxy(output, {
    get(target, property) {
      if (property === 'write') {
        return (chunk, ...args) => {
          const isBuffer = Buffer.isBuffer(chunk);
          const text = isBuffer ? chunk.toString('utf8') : String(chunk);
          const safe = text.replace(/\x1b\[0J/g, '\x1b[2K');
          return target.write(isBuffer ? Buffer.from(safe, 'utf8') : safe, ...args);
        };
      }
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

function createActionChannel() {
  const queue = [];
  let waiter = null;
  return {
    push(value) {
      if (waiter) { const pending = waiter; waiter = null; pending.resolve(value); }
      else queue.push(value);
    },
    next() {
      if (queue.length) return Promise.resolve(queue.shift());
      if (!waiter) {
        let resolve;
        const promise = new Promise((accept) => { resolve = accept; });
        waiter = { promise, resolve };
      }
      return waiter.promise;
    },
  };
}

export function routeTuiInput(value, { layout, dispatch, writeText, restoreEditor = () => {} }) {
  const parsed = splitMouseInput(Buffer.isBuffer(value) ? value.toString('utf8') : String(value));
  for (const event of parsed.events) {
    const action = layout.actionAt(event.column, event.row);
    layout.setHover(action);
    if (event.button === 0 && event.phase === 'M' && action) {
      layout.setFocus(action);
      dispatch(action);
    }
  }
  const text = parsed.text;
  for (let index = 0; index < text.length;) {
    const sequence = text.slice(index, index + 3);
    const token = ['\x1b[Z', '\x1b[C', '\x1b[D'].includes(sequence) ? sequence : text[index];
    index += token.length;
    if (!layout.focusedAction) {
      if (token === '\t' || token === '\x1b[Z') layout.moveFocus(token === '\x1b[Z' ? -1 : 1);
      else writeText(token);
      continue;
    }
    if (token === '\t' || token === '\x1b[C') layout.moveFocus(1);
    else if (token === '\x1b[Z' || token === '\x1b[D') layout.moveFocus(-1);
    else if (token === '\x1b') { layout.setFocus(null); restoreEditor(); }
    else if (token === '\r' || token === '\n' || token === ' ') dispatch(layout.focusedAction);
    else {
      layout.setFocus(null);
      restoreEditor();
      writeText(token);
    }
  }
}

export function createTuiInputRouter(options) {
  let pendingMouse = '';
  const pasteDecoder = createBracketedPasteDecoder({
    writeText: (value) => route(value),
    writePaste: (value) => options.writeText(encodeComposerPaste(value)),
  });
  const route = (value) => {
    const combined = pendingMouse + (Buffer.isBuffer(value) ? value.toString('utf8') : String(value));
    pendingMouse = '';
    const start = combined.lastIndexOf('\x1b[<');
    if (start >= 0 && /^\x1b\[<[\d;]*$/.test(combined.slice(start))) {
      pendingMouse = combined.slice(start);
      if (start) routeTuiInput(combined.slice(0, start), options);
      return;
    }
    routeTuiInput(combined, options);
  };
  return (value) => pasteDecoder.push(value);
}

export function encodeClipboardInput(text, targetPlatform = process.platform) {
  return targetPlatform === 'win32' ? Buffer.from(String(text), 'utf16le') : String(text);
}

function clipboard(text) {
  const tool = process.platform === 'win32' ? ['clip.exe', []]
    : process.platform === 'darwin' ? ['pbcopy', []]
      : ['sh', ['-c', 'command -v wl-copy >/dev/null && wl-copy || xclip -selection clipboard']];
  const result = spawnSync(tool[0], tool[1], { input: encodeClipboardInput(text), windowsHide: true });
  if (result.status !== 0) throw new Error('Clipboard tool is unavailable.');
}

function displayCwd(project, cwd) {
  return relative(project.root, cwd).replaceAll('\\', '/') || '.';
}

export function deliverShellProjection(value, show, clipboardWriter = clipboard, source = 'evidence') {
  show(`${value}\n\n`);
  try {
    clipboardWriter(value);
    show(`COPIED ${source}\n\n`);
    return { value, copied: true };
  } catch (error) {
    show(`NOT COPIED · ${error.message}\nProjection remains visible above.\n\n`);
    return { value, copied: false };
  }
}

export function renderShellResult(project, record, suppliedContext = null) {
  const operation = record.operation;
  const context = suppliedContext || buildOperationContext(project, record);
  const lines = [
    `${record.status.toUpperCase()} · exit ${record.exitCode ?? 'none'} · ${(record.durationMs / 1000).toFixed(1)}s`,
  ];
  if (operation?.summary?.length) lines.push(operation.summary.join(' · '));
  if (record.delta?.paths?.length) lines.push(`CHANGED ${record.delta.paths.length} · ${record.delta.paths.join(', ')}`);
  const metrics = context.metrics;
  lines.push(`RAW ${metrics.rawBytes} B → CONTEXT ${metrics.contextBytes} B · ${metrics.reductionPercent}% shorter`);
  lines.push(`RUN ${record.id} · /copy · /raw · /undo`);
  return lines.join('\n');
}

export async function deliverShellResult(project, record, output, clipboardWriter = clipboard) {
  const currentContext = await buildCurrentOperationContext(project, record);
  const context = currentContext.handoff;
  output.write(`${renderShellResult(project, record, currentContext)}\n\nSHORTENED OUTPUT\n${context}\n`);
  try {
    clipboardWriter(context);
    output.write(`\nCOPIED · run:${record.id}\n\n`);
    return { context, copied: true };
  } catch (error) {
    output.write(`\nNOT COPIED · ${error.message}\nUse /copy to try again.\n\n`);
    return { context, copied: false };
  }
}

export async function startHudShell(project, {
  shell: requestedShell = process.platform === 'win32' ? 'powershell' : 'bash',
  input = process.stdin, output = process.stdout,
  clipboardWriter = clipboard,
  visual = true,
  tui = false,
} = {}) {
  let restoreOutputTrace = () => {};
  if (process.env.COMMANDHUD_TRACE_WRITES === '1') {
    const tracePath = `${process.env.TEMP || process.env.TMP || process.cwd()}\\commandhud-write-trace.jsonl`;
    const { appendFileSync, writeFileSync } = await import('node:fs');
    const originalOutputWrite = output.write;
    let outputWriteSequence = 0;
    try { writeFileSync(tracePath, '', 'utf8'); } catch {}
    output.write = function tracedOutputWrite(chunk, ...args) {
      const text = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
      const caller = new Error().stack?.split('\n').slice(2, 6).map((line) => line.trim()).join(' <- ') || '';
      try {
        appendFileSync(tracePath, `${JSON.stringify({
          sequence: ++outputWriteSequence, rows: Number(output.rows) || null,
          columns: Number(output.columns) || null, text, caller,
        })}\n`, 'utf8');
      } catch {}
      return originalOutputWrite.call(this, chunk, ...args);
    };
    restoreOutputTrace = () => { output.write = originalOutputWrite; };
  }

  const session = await createShellSession(project, { shell: requestedShell });
  const interactive = Boolean(input.isTTY && output.isTTY);
  const motion = visualMotionEnabled({ interactive, requested: visual && tui });
  const layout = createShellLayout(output, { enabled: interactive && tui });
  const filteredInput = interactive && tui ? new PassThrough() : input;
  if (filteredInput !== input) {
    filteredInput.isTTY = true;
    filteredInput.setRawMode = (mode) => input.setRawMode?.(mode);
  }
  const readlineOutput = createTuiReadlineOutput(output, interactive && tui);
  const terminal = createInterface({ input: filteredInput, output: readlineOutput, terminal: interactive });
  const commandLines = terminal[Symbol.asyncIterator]();
  const actions = createActionChannel();
  let pendingLine = null;
  if (layout.active === false && interactive && tui) layout.start();
  if (!layout.active) {
    output.write(`${IDLE_FACE} Indro · semantic development system\n`);
    output.write(`Repository: ${basename(project.root)} · Shell: ${session.shell.label} · /help for controls\n\n`);
  }

  const show = (value) => layout.active ? layout.renderOutput(String(value).trimEnd()) : output.write(value);

  const presentBuiltin = (result) => {
    if (result.provider) layout.updateShell(result.provider.label);
    if (result.record) show(`${renderShellResult(project, result.record)}\n\n`);
    else if (result.name === 'copy') {
      try { clipboardWriter(result.clipboard); show(`COPIED ${result.clipboardSource}\n\n${result.text}`); }
      catch (error) { show(`NOT COPIED · ${error.message}\nContext remains available with /context ${result.clipboardSource.slice(4)}.\n\n`); }
    }
    else if (result.clipboard) deliverShellProjection(result.text, show, clipboardWriter, result.clipboardSource);
    else if (result.text) show(`${result.text}\n\n`);
    return result;
  };

  const routeInput = createTuiInputRouter({
      layout,
      dispatch: (action) => actions.push(action),
      writeText: (text) => filteredInput.write(text),
      restoreEditor: () => {
        layout.placePrompt();
        terminal.setPrompt('> ');
        terminal.prompt(true);
      },
  });
  const inputHandler = (chunk) => {
    if (!layout.active) return;
    routeInput(chunk);
  };
  if (layout.active) input.on('data', inputHandler);

  terminal.on('SIGINT', () => {
    if (session.cancelActiveExecution()) return;
    terminal.close();
  });
  try {
    while (true) {
      let command;
      try {
        if (interactive && !layout.focusedAction) {
          if (layout.active) layout.placePrompt();
          terminal.setPrompt('> ');
          terminal.prompt(true);
        }
        pendingLine ||= commandLines.next().then((value) => ({ kind: 'line', value }));
        const interaction = layout.active
          ? await Promise.race([pendingLine, actions.next().then((action) => ({ kind: 'action', action }))])
          : await pendingLine;
        if (interaction.kind === 'action') {
          try {
            if (interaction.action === 'details') { layout.toggleDetails(); continue; }
            const result = presentBuiltin(await session.execute(`/${interaction.action}`));
            if (result.exit) break;
          } catch (error) { show(`${error.message}\n\n`); }
          continue;
        }
        const next = interaction.value;
        pendingLine = null;
        if (layout.active) layout.clearPrompt();
        if (next.done) break;
        command = next.value;
        if (!interactive) output.write(`${session.shell.id} ${displayCwd(project, session.cwd)}> ${command}\n`);
      }
      catch { break; }
      while (!session.isInputComplete(command)) {
        let continuation = null;
        try {
          if (interactive && layout.active) {
            layout.placePrompt();
            terminal.setPrompt('... ');
            terminal.prompt(true);
          } else if (interactive) {
            terminal.setPrompt('... ');
            terminal.prompt(true);
          }
          const next = await commandLines.next();
          if (layout.active) layout.clearPrompt();
          if (!next.done) {
            continuation = next.value;
            if (!interactive) output.write(`... ${continuation}\n`);
          }
        } catch {}
        if (continuation === null) {
          show('INPUT_INCOMPLETE\nPowerShell block ended before its syntax was complete. Nothing was executed.\n\n');
          command = '';
          break;
        }
        command += `\n${continuation}`;
        if (command.length > MAX_TERMINAL_INPUT_CHARACTERS) {
          show('INPUT_REJECTED\nMultiline command exceeds 1 MiB. Nothing was executed.\n\n');
          command = '';
          break;
        }
      }
      const containedPaste = command.includes(COMPOSER_ESCAPE);
      command = decodeComposerText(command);
      if (!containedPaste) command = command.trim();
      if (!command.trim()) continue;
      layout.setFocus(null);
      if (layout.active && /^\/(?:details|collapse)$/i.test(command)) {
        layout.toggleDetails();
        continue;
      }
      if (session.isBuiltin(command)) {
        try {
          const result = presentBuiltin(await session.execute(command, { source: 'terminal-ui' }));
          if (result.exit) break;
        } catch (error) { show(`${error.message}\n\n`); }
        continue;
      }
      const visualStatus = createShellVisualStatus(output, {
        enabled: layout.active || motion, animated: motion,
        morph: process.env.COMMANDHUD_PARTICLE_MORPH === '1',
        row: layout.active ? 2 : null, showFace: !layout.active,
      });
      try {
        visualStatus.start(command);
        const record = await session.execute(command, { stream: false, source: 'terminal-ui' });
        await visualStatus.finish(record.status);
        if (layout.active) layout.setFace(record.status);
        if (layout.active) {
          const currentContext = await buildCurrentOperationContext(project, record);
          const context = currentContext.handoff;
          let copyState;
          try { clipboardWriter(context); copyState = `COPIED · run:${record.id}`; }
          catch (error) { copyState = `NOT COPIED · ${error.message} · use /copy to retry`; }
          layout.renderDisclosure(
            `${renderShellResult(project, record, currentContext)}\n${copyState}\n\nDETAILS HIDDEN · /details opens compact evidence`,
            `COMPACT EVIDENCE\n${context}`,
          );
        } else await deliverShellResult(project, record, output, clipboardWriter);
      } catch (error) {
        await visualStatus.finish(error.name === 'AbortError' ? 'interrupted' : 'fail');
        if (layout.active) layout.setFace(error.name === 'AbortError' ? 'interrupted' : 'fail');
        show(`ERROR · ${error.message}\n\n`);
      } finally {
        visualStatus.clear();
      }
    }
  } finally {
    input.removeListener('data', inputHandler);
    if (filteredInput !== input) filteredInput.end();
    terminal.close();
    layout.finish();
    restoreOutputTrace();
  }
}
