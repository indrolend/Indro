import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { inflateSync } from 'node:zlib';

const PNG_SIGNATURE = Buffer.from('89504e470d0a1a0a', 'hex');

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function inspectPng(path) {
  const bytes = readFileSync(path);
  if (bytes.length < 8 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)) throw new Error('INVALID_PNG');
  let offset = 8;
  let width, height, idat = [], ended = false;
  while (offset < bytes.length) {
    if (offset + 12 > bytes.length) throw new Error('INVALID_PNG');
    const length = bytes.readUInt32BE(offset);
    const end = offset + 12 + length;
    if (end > bytes.length) throw new Error('INVALID_PNG');
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    if (crc32(bytes.subarray(offset + 4, offset + 8 + length)) !== bytes.readUInt32BE(end - 4)) throw new Error('INVALID_PNG_CRC');
    if (offset === 8 && (type !== 'IHDR' || length !== 13)) throw new Error('INVALID_PNG');
    if (type === 'IHDR') {
      if (offset !== 8) throw new Error('INVALID_PNG');
      width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      if (!width || !height) throw new Error('INVALID_PNG_DIMENSIONS');
      if (data[10] !== 0 || data[11] !== 0 || data[12] > 1) throw new Error('INVALID_PNG');
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') {
      if (length !== 0 || !idat.length || end !== bytes.length) throw new Error('INVALID_PNG');
      ended = true;
    }
    offset = end;
    if (ended) break;
  }
  if (!ended) throw new Error('INVALID_PNG');
  try { inflateSync(Buffer.concat(idat)); } catch { throw new Error('INVALID_PNG_DATA'); }
  return { path: resolve(path), bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), width, height };
}

export function verifyPng(path, expected = {}) {
  try {
    const artifact = inspectPng(path);
    const issues = [];
    if (expected.width !== undefined && artifact.width !== expected.width) issues.push('WIDTH_MISMATCH');
    if (expected.height !== undefined && artifact.height !== expected.height) issues.push('HEIGHT_MISMATCH');
    if (expected.sha256 !== undefined && artifact.sha256 !== expected.sha256) issues.push('ARTIFACT_DIGEST_MISMATCH');
    return { valid: issues.length === 0, issues, artifact };
  } catch (error) {
    return { valid: false, issues: [error.message], artifact: null };
  }
}
