import { resolve } from 'node:path';
import { discoverShells, repositoryDirectory, runTerminalCommand } from './core.mjs';

export class ShellSession {
  constructor(project, { shells, shell, executeTerminal = runTerminalCommand } = {}) {
    this.project = project;
    this.cwd = project.root;
    this.shells = shells;
    this.shell = shell;
    this.provider = shell;
    this.activeExecution = null;
    this.executeTerminal = executeTerminal;
  }

  async execute(input, { source = 'terminal-ui', ...options } = {}) {
    if (this.activeExecution) throw new Error('A shell operation is already active.');
    const controller = new AbortController();
    const execution = { controller, input: String(input), source, startedAt: new Date().toISOString() };
    this.activeExecution = execution;
    try {
      const record = await this.executeTerminal(this.project, input, {
        ...options, shell: this.shell.id, cwd: this.cwd, signal: controller.signal, origin: source,
      });
      this.cwd = record.operation.cwdAfter;
      return record;
    } finally {
      if (this.activeExecution === execution) this.activeExecution = null;
    }
  }

  changeDirectory(path) {
    this.cwd = repositoryDirectory(this.project.root, resolve(this.cwd, path));
    return this.cwd;
  }

  setShell(id) {
    const selected = this.shells.find((entry) => entry.id === id && entry.available);
    if (!selected) throw new Error(`Terminal shell is unavailable: ${id || '(missing)'}`);
    this.shell = selected;
    this.provider = selected;
    return selected;
  }

  setProvider(id) {
    return this.setShell(id);
  }

  cancelActiveExecution() {
    if (!this.activeExecution) return false;
    this.activeExecution.controller.abort();
    return true;
  }
}

export async function createShellSession(project, {
  shell: requestedShell = process.platform === 'win32' ? 'powershell' : 'bash',
  discover = discoverShells,
  executeTerminal = runTerminalCommand,
} = {}) {
  const shells = await discover(project.root);
  const shell = shells.find((entry) => entry.id === requestedShell && entry.available);
  if (!shell) throw new Error(`Terminal shell is unavailable: ${requestedShell}`);
  return new ShellSession(project, { shells, shell, executeTerminal });
}
