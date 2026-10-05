import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  applySandboxPatch, createSandboxJob, discardSandboxJob, executeSandboxCommand,
  listSandboxJobs, readSandboxFile, resolveProject, sandboxDiff, sandboxJobState, sandboxMediaArtifact, searchSandbox,
} from './core.mjs';

test('one CommandHUD sandbox supports iterative local development without touching authority', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'commandhud-sandbox-project-'));
  const store = mkdtempSync(join(tmpdir(), 'commandhud-sandbox-state-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  t.after(() => rmSync(store, { recursive: true, force: true }));
  writeFileSync(join(root, 'file.txt'), 'alpha\n');
  execFileSync('git', ['init', '-b', 'main'], { cwd: root, stdio: 'pipe' });
  execFileSync('git', ['config', 'user.email', 'hud@example.invalid'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'HUD Test'], { cwd: root });
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['commit', '-m', 'fixture'], { cwd: root, stdio: 'pipe' });
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  const project = await resolveProject({ root, env: { ...process.env, HUD_STATE_ROOT: store } });

  const created = await createSandboxJob(project, 'Iterate on the fixture safely.', { expectedHead: head });
  assert.equal(created.baseSha, head);
  assert.equal(created.head, head);
  assert.equal(created.dirty, false);
  assert.equal(readFileSync(join(root, 'file.txt'), 'utf8'), 'alpha\n');
  assert.deepEqual((await listSandboxJobs(project)).map(({ id }) => id), [created.id]);

  const source = readSandboxFile(project, created.id, 'file.txt', { startLine: 1, endLine: 1 });
  assert.equal(source.content, 'alpha');
  const search = await searchSandbox(project, created.id, 'alpha');
  assert.equal(search.status, 'pass');

  const firstPatch = await applySandboxPatch(project, created.id, [
    'diff --git a/file.txt b/file.txt',
    '--- a/file.txt',
    '+++ b/file.txt',
    '@@ -1 +1 @@',
    '-alpha',
    '+beta',
    '',
  ].join('\n'));
  assert.equal(firstPatch.status, 'pass');
  const observed = await executeSandboxCommand(project, created.id, [
    process.execPath, '-e', "process.exit(require('fs').readFileSync('file.txt','utf8').trim()==='beta'?0:1)",
  ]);
  assert.equal(observed.status, 'pass');

  const secondPatch = await applySandboxPatch(project, created.id, [
    'diff --git a/file.txt b/file.txt',
    '--- a/file.txt',
    '+++ b/file.txt',
    '@@ -1 +1 @@',
    '-beta',
    '+gamma',
    '',
  ].join('\n'));
  assert.equal(secondPatch.status, 'pass');
  const diff = await sandboxDiff(project, created.id);
  assert.equal(diff.status, 'pass');
  assert.match(readFileSync(diff.stdoutPath, 'utf8'), /gamma/);
  const state = await sandboxJobState(project, created.id);
  assert.equal(state.dirty, true);
  assert.equal(readFileSync(join(root, 'file.txt'), 'utf8'), 'alpha\n');

  const mediaPath = join(created.workspace, 'frame.png');
  const mediaBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  writeFileSync(mediaPath, mediaBytes);
  const artifact = await sandboxMediaArtifact(project, created.id, 'frame.png');
  assert.equal(artifact.name, 'frame.png');
  assert.equal(artifact.mediaType, 'image/png');
  assert.equal(artifact.byteLength, mediaBytes.length);
  assert.equal(artifact.sha256, '4c4b6a3be1314ab86138bef4314dde022e600960d8689a2c8f8631802d20dab6');
  assert.equal(artifact.jobId, created.id);
  assert.equal(artifact.head, head);
  assert.deepEqual(artifact.bytes, mediaBytes);
  await assert.rejects(() => sandboxMediaArtifact(project, created.id, '../frame.png'), /contained relative path/);
  writeFileSync(join(created.workspace, 'not-media.txt'), 'not media');
  await assert.rejects(() => sandboxMediaArtifact(project, created.id, 'not-media.txt'), /supports PNG/);

  const recordPath = join(store, 'runs', project.key, created.id, 'sandbox.json');
  const record = JSON.parse(readFileSync(recordPath, 'utf8'));
  writeFileSync(recordPath, `${JSON.stringify({ ...record, sourceRoot: join(root, 'historical-authority') }, null, 2)}\n`);
  const historical = await sandboxJobState(project, created.id);
  assert.equal(historical.sourceAuthorityCurrent, false);
  assert.equal((await listSandboxJobs(project))[0].sourceAuthorityCurrent, false);
  const continued = await executeSandboxCommand(project, created.id, [process.execPath, '-e', 'process.exit(0)']);
  assert.equal(continued.status, 'pass');
  assert.equal((await sandboxMediaArtifact(project, created.id, 'frame.png')).sha256, artifact.sha256);
  writeFileSync(recordPath, `${JSON.stringify(record, null, 2)}\n`);

  const discarded = await discardSandboxJob(project, created.id);
  assert.equal(discarded.status, 'DISCARDED');
  assert.equal((await sandboxJobState(project, created.id)).workspaceAvailable, false);
  assert.equal(readFileSync(join(root, 'file.txt'), 'utf8'), 'alpha\n');
});
