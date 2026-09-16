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
    this.listeners = new Set();
    this.executionSequence = 0;
  }

  get shell() { return this.provider; }
  get shells() { return this.providers; }

  async execute(input, { source = 'terminal-ui', ...options } = {}) {
    if (this.isBuiltin(input)) {
      const startedAt = new Date().toISOString();
      const result = await executeShellBuiltin(this, input);
      this.publish({ type: 'builtin', command: String(input), startedAt, completedAt: new Date().toISOString(), result });
      return result;
    }
    if (this.activeExecution) throw new Error('A shell operation is already active.');
    const controller = new AbortController();
    const execution = {
      id: `active:${++this.executionSequence}`, controller, input: String(input), source,
      cwd: this.cwd, provider: this.provider.id, startedAt: new Date().toISOString(), runId: null,
    };
    this.activeExecution = execution;
    this.publish({ type: 'execution-start', execution: this.executionView(execution) });
    try {
      const record = await this.provider.execute({
        input: String(input), cwd: this.cwd, signal: controller.signal, source,
        options: {
          ...options,
          onStart: (value) => {
            Object.assign(execution, { runId: value.runId, startedAt: value.startedAt, stdoutPath: value.stdoutPath, stderrPath: value.stderrPath });
            this.publish({ type: 'execution-update', execution: this.executionView(execution) });
            options.onStart?.(value);
          },
        },
      });
      this.cwd = record.operation.cwdAfter;
      this.publish({ type: 'execution-end', execution: this.executionView(execution), record });
      return record;
    } catch (error) {
      this.publish({ type: 'execution-end', execution: this.executionView(execution), error });
      throw error;
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

  subscribe(listener) {
    if (typeof listener !== 'function') throw new TypeError('Shell session listener must be a function.');
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  publish(event) {
    for (const listener of this.listeners) {
      try { listener(event); } catch {}
    }
  }

  executionView(execution = this.activeExecution) {
    if (!execution) return null;
    const { controller: _controller, ...view } = execution;
    return { ...view, canCancel: true };
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
