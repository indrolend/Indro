import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inspect, compare, runWorkbench } from './workbench.mjs';

test('inspect reports stable file checksum and size', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'indro-work-'));
  const p = join(dir, 'a.txt'); await writeFile(p, 'abc');
  const x = await inspect(p);
  assert.equal(x.size, 3);
  assert.equal(x.sha256, 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});
test('compare detects different bytes and identical bytes', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'indro-work-'));
  const a = join(dir, 'a'), b = join(dir, 'b');
  await writeFile(a, 'abc'); await writeFile(b, 'abc');
  assert.equal((await compare(a, b)).verdict, 'IDENTICAL_BYTES');
  await writeFile(b, 'abd');
  assert.equal((await compare(a, b)).verdict, 'DIFFERENT');
});
test('CLI records and validates evidence', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'indro-work-'));
  const p = join(dir, 'a'); await writeFile(p, 'abc');
  const output = [], errors = [];
  assert.equal(await runWorkbench(['inspect', p], x => output.push(x), x => errors.push(x), dir), 0);
  const id = JSON.parse(output[0]).evidence_id;
  assert.equal(await runWorkbench(['evidence', id], x => output.push(x), x => errors.push(x), dir), 0);
  assert.equal(JSON.parse(output[1]).integrity, 'VALID');
  const file = join(dir, '.indro', 'evidence', id + '.json');
  const payload = JSON.parse(await readFile(file, 'utf8')); payload.result.size = 999;
  await writeFile(file, JSON.stringify(payload));
  assert.equal(await runWorkbench(['evidence', id], x => output.push(x), x => errors.push(x), dir), 1);
  assert.equal(JSON.parse(output[2]).integrity, 'INVALID');
});
test('unsupported operations are rejected', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'indro-work-'));
  assert.equal(await runWorkbench(['run', 'echo'], () => {}, () => {}, dir), 2);
});
