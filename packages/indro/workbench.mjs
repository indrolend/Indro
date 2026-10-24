import { stat, readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { resolve, join, relative } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

const sha = value => createHash('sha256').update(value).digest('hex');
const record = async (kind, result, root = process.cwd()) => {
  const id = randomUUID(), created = new Date().toISOString();
  const entry = { schema_version: '1', id, kind, created, result };
  const directory = join(root, '.indro', 'evidence');
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, id + '.json'), JSON.stringify({ ...entry, sha256: sha(JSON.stringify(entry)) }, null, 2) + '\n', { flag: 'wx' });
  return id;
};
const rejectOption = x => { if (!x || x.startsWith('-')) throw Error('Expected a target path, not an option'); return x; };
export async function inspect(target) {
  const location = resolve(rejectOption(target));
  const s = await stat(location);
  if (s.isFile()) {
    const bytes = await readFile(location);
    return { target: location, type: 'file', size: bytes.length, sha256: sha(bytes) };
  }
  if (!s.isDirectory()) throw Error('Unsupported target type');
  const names = (await readdir(location, { withFileTypes: true })).map(e => ({ name: e.name, type: e.isDirectory() ? 'directory' : e.isFile() ? 'file' : 'other' }));
  return { target: location, type: 'directory', entries: names };
}
export async function compare(left, right) {
  const [a, b] = await Promise.all([inspect(left), inspect(right)]);
  if (a.type !== b.type) return { verdict: 'DIFFERENT', left: a, right: b };
  if (a.type === 'file') return { verdict: a.sha256 === b.sha256 ? 'IDENTICAL_BYTES' : 'DIFFERENT', left: a, right: b };
  return { verdict: isDeepStrictEqual(a.entries, b.entries) ? 'SAME_TOP_LEVEL_ENTRIES' : 'DIFFERENT', left: a, right: b, limitation: 'Directory contents and runtime behavior not compared' };
}
export async function runWorkbench(argv, out = console.log, err = console.error, root = process.cwd()) {
  const [command, ...args] = argv;
  if (!command || command === 'help') {
    out('indro work inspect <path> | compare <left> <right> | evidence <id> | help');
    return 0;
  }
  try {
    if (command === 'evidence') {
      if (args.length !== 1 || !/^[0-9a-f-]{36}$/.test(args[0])) throw Error('Expected evidence UUID');
      const entry = JSON.parse(await readFile(join(root, '.indro', 'evidence', args[0] + '.json'), 'utf8'));
      const { sha256, ...payload } = entry;
      out(JSON.stringify({ ...entry, integrity: sha(JSON.stringify(payload)) === sha256 ? 'VALID' : 'INVALID' }, null, 2));
      return sha(JSON.stringify(payload)) === sha256 ? 0 : 1;
    }
    if (command === 'inspect' && args.length === 1) {
      const result = await inspect(args[0]); const id = await record('inspect', result, root);
      out(JSON.stringify({ evidence_id: id, ...result }, null, 2)); return 0;
    }
    if (command === 'compare' && args.length === 2) {
      const result = await compare(args[0], args[1]); const id = await record('compare', result, root);
      out(JSON.stringify({ evidence_id: id, ...result }, null, 2));
      return result.verdict === 'DIFFERENT' ? 1 : 0;
    }
    throw Error('Unsupported work command or argument count');
  } catch (error) { err('INDRO_ERROR ' + error.message); return 2; }
}
