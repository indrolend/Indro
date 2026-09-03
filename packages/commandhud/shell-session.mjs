import { resolve } from 'node:path';
import { repositoryDirectory } from './core.mjs';
import { createProcessProviders } from './execution-provider.mjs';
import { executeShellBuiltin, matchesShellBuiltin } from './shell-builtins.mjs';

export class ShellSession {
  constructor(project, { providers, provider } = {}) {
    this.project = project;
    this.cwd = project.root;
    this.providers = providers;
    this.provider = provider;
    this.activeExecution = null;
  }

  get shell() { return this.provider; }
  get shells() { return this.providers; }

  async execute(input, { source = 'terminal-ui', ...options } = {}) {
    if (this.isBuiltin(input)) return executeShellBuiltin(this, input);
    if (this.activeExecution) throw new Error('A shell operation is already active.');
    const controller = new AbortController();
    const execution = { controller, input: String(input), source, startedAt: new Date().toISOString() };
    this.activeExecution = execution;
    try {
      const record = await this.provider.execute({
        input: String(input), cwd: this.cwd, signal: controller.signal, source, options,
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
    const selected = this.providers.find((entry) => entry.id === id);
    if (!selected) throw new Error(`Terminal shell is unavailable: ${id || '(missing)'}`);
    this.provider = selected;
    return selected;
  }

  setProvider(id) {
    return this.setShell(id);
  }

  cancelActiveExecution() {
    if (!this.activeExecution) return false;
    if (this.provider.cancel) this.provider.cancel(this.activeExecution);
    else this.activeExecution.controller.abort();
    return true;
  }

  isInputComplete(text) {
    return this.provider.isInputComplete ? this.provider.isInputComplete(text) : true;
  }

  isBuiltin(text) {
    return matchesShellBuiltin(text);
  }
}

export async function createShellSession(project, {
  shell: requestedShell = process.platform === 'win32' ? 'powershell' : 'bash',
  providers = null,
  discover,
  executeTerminal,
} = {}) {
  const available = providers || await createProcessProviders(project, { discover, executeTerminal });
  const provider = available.find((entry) => entry.id === requestedShell);
  if (!provider) throw new Error(`Terminal shell is unavailable: ${requestedShell}`);
  return new ShellSession(project, { providers: available, provider });
}
