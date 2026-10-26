import { generateKeyPairSync } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const path = resolve(process.argv[2] || '');
if (!process.argv[2]) throw new Error('usage: node generate-evidence-key.mjs PATH');
if (existsSync(path)) throw new Error(`refusing to overwrite existing key: ${path}`);
mkdirSync(dirname(path), { recursive: true });
const { privateKey } = generateKeyPairSync('ed25519');
writeFileSync(path, privateKey.export({ type: 'pkcs8', format: 'pem' }), { flag: 'wx', mode: 0o600 });
console.log(path);
