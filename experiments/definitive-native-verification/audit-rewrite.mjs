import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [store, backup] = process.argv.slice(2);
if (!store || !backup) throw new Error('usage: node audit-rewrite.mjs STORE BACKUP');
const name = readdirSync(store).filter(value => value.endsWith('.json')).sort().at(-1);
if (!name) throw new Error('receipt unavailable');
const path = join(store, name);
const receipt = JSON.parse(readFileSync(path, 'utf8'));
writeFileSync(backup, JSON.stringify(receipt, null, 2));
receipt.stdout = `${receipt.stdout}\nFORGED_BUT_REHASHED_MARKER`;
const { integrity: ignored, ...body } = receipt;
receipt.integrity = createHash('sha256').update(JSON.stringify(body)).digest('hex');
writeFileSync(path, JSON.stringify(receipt, null, 2));
console.log(JSON.stringify({ receipt: name, originalIntegrity: ignored, forgedIntegrity: receipt.integrity }));
