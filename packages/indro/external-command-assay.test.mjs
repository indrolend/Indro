import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { runAssay } from './tools/external-command-assay.mjs';

test('external command assay preserves success, failure, evidence, and worktree state', async () => {
  const parent = mkdtempSync(join(tmpdir(), 'indro-external-assay-'));
  const root = join(parent, 'source'), output = join(parent, 'evidence', 'result.json');
  mkdirSync(root);
  writeFileSync(join(root, 'fixture.txt'), 'fixture\n');
  execFileSync('git', ['init', '-q', root]);
  execFileSync('git', ['-C', root, 'remote', 'add', 'origin', 'https://example.invalid/fixture.git']);
  execFileSync('git', ['-C', root, 'add', '.']);
  execFileSync('git', ['-C', root, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'fixture']);
  try {
    const result = await runAssay({ root, output, name: 'fixture', type: 'Node', trials: 1, command: [process.execPath, '-e', "console.log('PASS')"] });
    assert.equal(result.report.claims.behaviorPreserved, true);
    assert.equal(result.report.claims.failurePreserved, true);
    assert.equal(result.report.claims.resultReuseMeasured, false);
    assert.equal(result.report.worktree.unchanged, true);
    assert.equal(result.report.observations.length, 2);
    assert.equal(result.report.observations.find(value => value.mode === 'indro').integrity, 'VERIFIED');
    assert.equal(JSON.parse(readFileSync(output, 'utf8')).schema, 'indro.external-command-assay/v1');
  } finally { rmSync(parent, { recursive: true, force: true }); }
});
