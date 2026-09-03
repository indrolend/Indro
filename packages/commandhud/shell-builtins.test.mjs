import test from 'node:test';
import assert from 'node:assert/strict';
import { executeShellBuiltin, listShellBuiltins, matchesShellBuiltin } from './shell-builtins.mjs';

function session() {
  const providers = [{ id: 'powershell', label: 'PowerShell' }, { id: 'bash', label: 'Bash' }];
  return {
    cwd: 'C:\\fixture', providers, provider: providers[0], project: {},
    setProvider(id) { this.provider = providers.find((provider) => provider.id === id); return this.provider; },
  };
}

test('built-in registry exposes compatibility commands without renderer state', () => {
  const names = listShellBuiltins().map(({ name }) => name);
  assert.deepEqual(names, ['exit', 'help', 'cwd', 'shell', 'copy', 'evidence', 'diff', 'history', 'proof', 'undo']);
  assert.equal(matchesShellBuiltin('/history 5'), true);
  assert.equal(matchesShellBuiltin('git status'), false);
});

test('cwd, shell, help, and exit semantics execute against the session', async () => {
  const value = session();
  assert.deepEqual(await executeShellBuiltin(value, '/cwd'), { kind: 'builtin', name: 'cwd', text: 'C:\\fixture' });
  const changed = await executeShellBuiltin(value, '/shell bash');
  assert.equal(changed.provider, value.providers[1]);
  assert.equal(value.provider.id, 'bash');
  assert.match((await executeShellBuiltin(value, '/help')).text, /\/history/);
  assert.equal((await executeShellBuiltin(value, '/exit')).exit, true);
});
