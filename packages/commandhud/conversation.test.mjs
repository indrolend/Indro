import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildConversation, projectActiveExecution, projectBuiltinExchange, projectRunToConversation, projectRunsToConversation,
} from './conversation.mjs';

function run(id, overrides = {}) {
  return {
    id, startedAt: `2026-09-03T10:00:0${id}.000Z`, endedAt: `2026-09-03T10:00:1${id}.000Z`,
    status: 'pass', exitCode: 0, durationMs: 8412, cwd: '/repo',
    command: 'transport noise', stdoutPath: `/evidence/${id}/stdout.log`, stderrPath: `/evidence/${id}/stderr.log`,
    evidence: { stdout: { bytes: 500, sha256: 'sha256:stdout' }, stderr: { bytes: 0, sha256: 'sha256:stderr' } },
    provenance: { origin: 'terminal-ui' }, reduction: { summary: ['generic summary'] },
    operation: { type: 'terminal-command', displayCommand: 'npm test', shell: 'bash', cwdBefore: '/repo', cwdAfter: '/repo', summary: ['114 tests passed'] },
    delta: { paths: [], patchPath: null }, ...overrides,
  };
}

test('completed operation projects as a paired command and bounded result', () => {
  const [command, result] = projectRunToConversation(run('1'));
  assert.deepEqual([command.kind, result.kind], ['command', 'result']);
  assert.equal(command.runId, '1');
  assert.equal(result.runId, '1');
  assert.equal(command.content.command, 'npm test');
  assert.equal(result.content.status, 'pass');
  assert.deepEqual(result.content.summary, ['114 tests passed']);
  assert.equal(result.content.durationMs, 8412);
});

test('failed operation preserves status and exit code', () => {
  const [, result] = projectRunToConversation(run('2', { status: 'fail', exitCode: 7 }));
  assert.equal(result.content.status, 'fail');
  assert.equal(result.content.exitCode, 7);
});

test('generic operation uses its existing bounded reduction tail as the reply', () => {
  const [, result] = projectRunToConversation(run('2', {
    operation: { type: 'terminal-command', displayCommand: 'printf hello', shell: 'bash', cwdBefore: '/repo', cwdAfter: '/repo', summary: [] },
    reduction: { summary: [], tail: ['hello', 'x'.repeat(400), 'third', 'not included'] },
  }));
  assert.deepEqual(result.content.summary, ['hello', 'x'.repeat(240), 'third']);
});

test('running operation projects an ephemeral cancellable reply', () => {
  const items = projectActiveExecution({ id: 'active:1', input: 'npm run dev', cwd: '/repo', provider: 'bash', source: 'mobile-ui', startedAt: '2026-09-03T10:00:00.000Z', canCancel: true });
  assert.equal(items[0].content.command, 'npm run dev');
  assert.equal(items[1].content.status, 'running');
  assert.equal(items[1].capabilities.canCancel, true);
  assert.equal(items[1].ephemeral, true);
});

test('built-in outcome becomes the same command and reply model without parsing client text', () => {
  const items = projectBuiltinExchange({
    command: '/shell bash', result: { kind: 'builtin', name: 'shell', text: 'SHELL Bash', provider: { id: 'bash', label: 'Bash' } },
    startedAt: '2026-09-03T10:00:00.000Z', completedAt: '2026-09-03T10:00:00.001Z', cwd: '/repo', provider: 'powershell',
  });
  assert.equal(items[0].kind, 'command');
  assert.equal(items[1].kind, 'notice');
  assert.equal(items[1].content.operation, 'builtin:shell');
  assert.equal(items[1].content.provider, 'bash');
  assert.equal(items[1].ephemeral, true);
});

test('cwd changes are reflected from authoritative operation context', () => {
  const [, result] = projectRunToConversation(run('3', { operation: { type: 'terminal-command', displayCommand: 'cd packages', shell: 'bash', cwdBefore: '/repo', cwdAfter: '/repo/packages', cwdPersistence: 'updated', summary: [] } }));
  assert.equal(result.content.cwdAfter, '/repo/packages');
  assert.equal(result.content.semanticFacts.cwdPersistence, 'updated');
});

test('history reconstruction is chronological and stable for identical timestamps', () => {
  const shared = '2026-09-03T10:00:00.000Z';
  const items = projectRunsToConversation([
    run('c', { startedAt: shared }), run('a', { startedAt: shared }), run('b', { startedAt: '2026-09-03T09:00:00.000Z' }),
  ]);
  assert.deepEqual(items.filter((item) => item.kind === 'command').map((item) => item.runId), ['b', 'a', 'c']);
});

test('raw evidence is referenced but never embedded in a bounded result', () => {
  const record = run('4', { rawSecret: 'FULL RAW OUTPUT MUST NOT APPEAR' });
  const [, result] = projectRunToConversation(record);
  assert.equal(result.evidence.stdout.path, '/evidence/4/stdout.log');
  assert.equal(result.evidence.stdout.sha256, 'sha256:stdout');
  assert.equal(result.capabilities.canViewRaw, true);
  assert.doesNotMatch(JSON.stringify(result), /FULL RAW OUTPUT MUST NOT APPEAR/);
});

test('conversation projection is renderer-neutral and merges live session state', () => {
  const view = buildConversation({ runs: [run('1')], session: { executionView: () => ({ id: 'active:2', input: 'git status', cwd: '/repo', provider: 'bash', startedAt: '2026-09-03T11:00:00.000Z' }) } });
  assert.equal(view.length, 4);
  assert.doesNotMatch(JSON.stringify(view), /readline|ANSI|DOM|layout/);
});
