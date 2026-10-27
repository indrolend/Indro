import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const PNG_SIGNATURE = Buffer.from('89504e470d0a1a0a', 'hex');

export function inspectPng(path) {
  const bytes = readFileSync(path);
  if (bytes.length < 24 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE) || bytes.toString('ascii', 12, 16) !== 'IHDR') {
    throw new Error('INVALID_PNG');
  }
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  if (!width || !height) throw new Error('INVALID_PNG_DIMENSIONS');
  return {
    path: resolve(path),
    bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    width,
    height,
  };
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
