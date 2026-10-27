import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { inspectPng, verifyPng } from './artifact.mjs';

function png(width, height) {
  const value = Buffer.from('89504e470d0a1a0a0000000d494844520000000000000000', 'hex');
  value.writeUInt32BE(width, 16);
  value.writeUInt32BE(height, 20);
  return value;
}

test('reads PNG IHDR dimensions and digest', () => {
  const path = join(mkdtempSync(join(tmpdir(), 'indro-paint-')), 'image.png');
  writeFileSync(path, png(320, 240));
  const value = inspectPng(path);
  assert.equal(value.width, 320);
  assert.equal(value.height, 240);
  assert.match(value.sha256, /^[a-f0-9]{64}$/);
});

test('fails closed on wrong dimensions, digest, and malformed bytes', () => {
  const root = mkdtempSync(join(tmpdir(), 'indro-paint-'));
  const path = join(root, 'image.png');
  writeFileSync(path, png(320, 240));
  assert.deepEqual(verifyPng(path, { width: 321, height: 240 }).issues, ['WIDTH_MISMATCH']);
  assert.deepEqual(verifyPng(path, { sha256: '0'.repeat(64) }).issues, ['ARTIFACT_DIGEST_MISMATCH']);
  writeFileSync(path, 'not a png');
  assert.deepEqual(verifyPng(path).issues, ['INVALID_PNG']);
});
