import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { inspectPng, verifyPng } from './artifact.mjs';
import { png } from './png-fixture.test-helper.mjs';

function fixture(bytes) {
  const path = join(mkdtempSync(join(tmpdir(), 'indro-paint-')), 'image.png');
  writeFileSync(path, bytes); return path;
}
test('reads complete PNG dimensions and digest', () => {
  const value = inspectPng(fixture(png(320, 240)));
  assert.equal(value.width, 320); assert.equal(value.height, 240);
  assert.match(value.sha256, /^[a-f0-9]{64}$/);
});
test('fails closed on wrong dimensions, digest, and malformed bytes', () => {
  const path = fixture(png(320, 240));
  assert.deepEqual(verifyPng(path, { width: 321, height: 240 }).issues, ['WIDTH_MISMATCH']);
  assert.deepEqual(verifyPng(path, { sha256: '0'.repeat(64) }).issues, ['ARTIFACT_DIGEST_MISMATCH']);
  writeFileSync(path, 'not a png');
  assert.deepEqual(verifyPng(path).issues, ['INVALID_PNG']);
});
test('rejects plausible IHDR-only and truncated artifacts', () => {
  const valid = png(320, 240);
  assert.deepEqual(verifyPng(fixture(valid.subarray(0, 24))).issues, ['INVALID_PNG']);
  assert.deepEqual(verifyPng(fixture(valid.subarray(0, -5))).issues, ['INVALID_PNG']);
});
test('rejects damaged CRC and compressed pixel data', () => {
  const damaged = png(320, 240);
  damaged[29] ^= 1;
  assert.deepEqual(verifyPng(fixture(damaged)).issues, ['INVALID_PNG_CRC']);
  const corrupted = png(320, 240);
  corrupted[50] ^= 1;
  const offset = 33, length = corrupted.readUInt32BE(offset);
  let crc = 0xffffffff;
  for (const byte of corrupted.subarray(offset + 4, offset + 8 + length)) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  corrupted.writeUInt32BE((crc ^ 0xffffffff) >>> 0, offset + 8 + length);
  assert.deepEqual(verifyPng(fixture(corrupted)).issues, ['INVALID_PNG_DATA']);
});
