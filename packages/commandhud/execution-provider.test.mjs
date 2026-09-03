import test from 'node:test';
import assert from 'node:assert/strict';
import { ProcessExecutionProvider, shellInputIncomplete } from './execution-provider.mjs';

test('process provider translates a canonical request into existing terminal execution', async () => {
  const project = { root: 'C:\\fixture' };
  let call;
  const expected = { id: 'run-1', operation: { cwdAfter: project.root } };
  const provider = new ProcessExecutionProvider(project, { id: 'powershell', label: 'PowerShell' }, {
    executeTerminal: async (...args) => { call = args; return expected; },
  });
  const signal = new AbortController().signal;
  const actual = await provider.execute({ input: 'git status', cwd: project.root, signal, source: 'terminal-ui', options: { stream: false } });
  assert.equal(actual, expected);
  assert.deepEqual(call, [project, 'git status', { stream: false, shell: 'powershell', cwd: project.root, signal, origin: 'terminal-ui' }]);
});

test('input completeness is provider-owned and remains shell-specific', () => {
  assert.equal(shellInputIncomplete('powershell', 'foreach ($x in 1,2) {'), true);
  assert.equal(shellInputIncomplete('powershell', "foreach ($x in 1,2) {\n  echo $x\n}"), false);
  assert.equal(shellInputIncomplete('bash', 'if true; then'), false);
});

test('process provider cancellation aborts the active execution controller', () => {
  const provider = new ProcessExecutionProvider({}, { id: 'bash', label: 'Bash' });
  const controller = new AbortController();
  provider.cancel({ controller });
  assert.equal(controller.signal.aborted, true);
});
