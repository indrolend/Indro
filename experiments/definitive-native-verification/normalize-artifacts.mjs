import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';

const root = process.argv[2];
const textExtensions = new Set(['.json', '.ndjson', '.log', '.md', '.mjs', '.ps1']);
function visit(path) {
  for (const name of readdirSync(path)) {
    const file = join(path, name);
    if (statSync(file).isDirectory()) visit(file);
    else if (textExtensions.has(extname(file))) {
      const text = readFileSync(file, 'utf8').replace(/^\uFEFF/, '').replaceAll('\r\n', '\n');
      writeFileSync(file, text);
    }
  }
}
visit(root);
