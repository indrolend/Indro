import { readFileSync, readdirSync, statSync } from 'node:fs';
import { relative, resolve } from 'node:path';

if (process.argv.includes('--version')) {
  console.log('commandhud-search-fixture 1');
  process.exit(0);
}

const separator = process.argv.indexOf('--');
if (separator < 0 || !process.argv[separator + 1] || !process.argv[separator + 2]) process.exit(2);
const query = process.argv[separator + 1];
const target = resolve(process.cwd(), process.argv[separator + 2]);
const files = [];
const visit = (path) => {
  const metadata = statSync(path);
  if (metadata.isDirectory()) {
    for (const name of readdirSync(path).sort()) visit(resolve(path, name));
  } else if (metadata.isFile()) files.push(path);
};
visit(target);

let matches = 0;
for (const path of files) {
  const display = relative(process.cwd(), path).replaceAll('\\', '/');
  for (const [index, line] of readFileSync(path, 'utf8').split(/\r?\n/).entries()) {
    if (!line.includes(query)) continue;
    console.log(`${display}:${index + 1}:${line}`);
    matches++;
  }
}
process.exit(matches ? 0 : 1);
