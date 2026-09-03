import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createShellSession } from './shell-session.mjs';
import { listRuns, resolveProject, runById } from './core.mjs';

const shells = [
  { id: 'powershell', label: 'PowerShell', available: true },
  { id: 'bash', label: 'Bash', available: true },
];

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'commandhud-session-'));
  mkdirSync(join(root, 'packages'));
  return { root, identity: { id: 'fixture/session' } };
}

function dependencies(records = []) {
  return {
    discover: async () => shells,
    executeTerminal: async (_project, command, options) => {
      const record = {
        id: `run-${records.length + 1}`, status: 'pass', exitCode: 0,
        operation: {
          type: 'terminal-command', displayCommand: command, shell: options.shell,
          cwdBefore: options.cwd, cwdAfter: options.cwd,
        },
      };
      records.push({ record, options });
      return record;
    },
  };
}

test('session starts at the project root and preserves cwd between operations', async () => {
  const project = fixture();
  const records = [];
  const session = await createShellSession(project, { shell: 'powershell', ...dependencies(records) });
  assert.equal(session.cwd, project.root);
  session.changeDirectory('packages');
  const record = await session.execute('git status');
  assert.equal(session.cwd, join(project.root, 'packages'));
  assert.equal(record.operation.cwdBefore, join(project.root, 'packages'));
  assert.equal(records[0].options.cwd, join(project.root, 'packages'));
});

test('selected shell/provider and active execution belong to the session', async () => {
  const project = fixture();
  let release;
  const executeTerminal = () => new Promise((resolve) => { release = resolve; });
  const session = await createShellSession(project, { shell: 'powershell', discover: async () => shells, executeTerminal });
  assert.equal(session.provider.id, 'powershell');
  session.setProvider('bash');
  assert.equal(session.shell.id, 'bash');
  const pending = session.execute('git status', { source: 'plain-shell' });
  assert.equal(session.activeExecution.input, 'git status');
  assert.equal(session.activeExecution.source, 'plain-shell');
  release({ id: 'run-1', status: 'pass', exitCode: 0, operation: { cwdAfter: project.root } });
  await pending;
  assert.equal(session.activeExecution, null);
});

test('client sources share canonical execution and evidence results', async () => {
  const project = fixture();
  const records = [];
  const session = await createShellSession(project, { shell: 'powershell', ...dependencies(records) });
  const plain = await session.execute('git status', { source: 'plain-shell' });
  const tui = await session.execute('git status', { source: 'terminal-ui' });
  assert.deepEqual(
    { ...plain, id: null },
    { ...tui, id: null },
  );
  assert.deepEqual(records.map(({ options }) => options.origin), ['plain-shell', 'terminal-ui']);
  assert.equal(records[0].record, plain);
  assert.equal(records[1].record, tui);
});

test('session rejects cwd outside the verified repository', async () => {
  const project = fixture();
  const session = await createShellSession(project, { shell: 'powershell', ...dependencies() });
  assert.throws(() => session.changeDirectory('..'), /outside the verified repository/);
});

test('session execution preserves the canonical immutable evidence record', async () => {
  const root = mkdtempSync(join(tmpdir(), 'commandhud-session-evidence-'));
  execFileSync('git', ['init', '-b', 'main'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'hud@example.invalid'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'HUD Test'], { cwd: root });
  execFileSync('git', ['commit', '--allow-empty', '-m', 'fixture'], { cwd: root });
  const project = await resolveProject({ root, env: { ...process.env, HUD_STATE_ROOT: join(root, '.state') } });
  const shell = process.platform === 'win32' ? 'powershell' : 'bash';
  const session = await createShellSession(project, { shell });
  const record = await session.execute('echo session-evidence', { source: 'terminal-ui' });
  assert.equal(record.status, 'pass');
  assert.ok(record.id);
  assert.equal(record.operation.type, 'terminal-command');
  assert.equal(record.operation.displayCommand, 'echo session-evidence');
  assert.equal(runById(project, record.id)?.id, record.id);
  assert.equal(listRuns(project, 10)[0]?.id, record.id);
});
