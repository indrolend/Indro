import { discoverShells, runTerminalCommand } from './core.mjs';

export function shellInputIncomplete(shell, value) {
  if (shell !== 'powershell') return false;
  const text = String(value || '').replace(/\r\n?/g, '\n');
  const stack = [];
  let quote = null;
  let blockComment = false;
  let hereString = null;
  const pairs = { '(': ')', '[': ']', '{': '}' };
  const closing = new Set(Object.values(pairs));
  const lines = text.split('\n');
  for (const line of lines) {
    if (hereString) {
      if (line.trim() === `${hereString}@`) hereString = null;
      continue;
    }
    for (let index = 0; index < line.length; index++) {
      const character = line[index];
      const next = line[index + 1];
      if (blockComment) {
        if (character === '#' && next === '>') { blockComment = false; index++; }
        continue;
      }
      if (quote) {
        if (quote === "'" && character === "'" && next === "'") { index++; continue; }
        if (quote === '"' && character === '`') { index++; continue; }
        if (character === quote) quote = null;
        continue;
      }
      if (character === '<' && next === '#') { blockComment = true; index++; continue; }
      if (character === '#') break;
      if (character === '@' && (next === '"' || next === "'") && !line.slice(index + 2).trim()) { hereString = next; break; }
      if (character === '"' || character === "'") { quote = character; continue; }
      if (character === '`') { index++; continue; }
      if (pairs[character]) stack.push(pairs[character]);
      else if (closing.has(character) && stack.at(-1) === character) stack.pop();
    }
  }
  const tail = lines.at(-1).trimEnd();
  return Boolean(hereString || blockComment || quote || stack.length || /(?:`|\||,)\s*$/.test(tail));
}

export class ProcessExecutionProvider {
  constructor(project, shell, { executeTerminal = runTerminalCommand } = {}) {
    this.project = project;
    this.id = shell.id;
    this.label = shell.label;
    this.shell = shell;
    this.executeTerminal = executeTerminal;
  }

  execute(request) {
    return this.executeTerminal(this.project, request.input, {
      ...request.options, shell: this.id, cwd: request.cwd, signal: request.signal, origin: request.source,
    });
  }

  cancel(execution) {
    execution.controller.abort();
  }

  isInputComplete(text) {
    return !shellInputIncomplete(this.id, text);
  }
}

export async function createProcessProviders(project, { discover = discoverShells, executeTerminal = runTerminalCommand } = {}) {
  const shells = await discover(project.root);
  return shells.filter((shell) => shell.available).map((shell) => new ProcessExecutionProvider(project, shell, { executeTerminal }));
}
