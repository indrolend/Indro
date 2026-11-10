import { verifyPng } from './artifact.mjs';

const USAGE = 'indro paint verify --file PATH --width N --height N --json';

export async function runPaintCli(argv, out = console.log) {
  const option = name => { const index = argv.indexOf(name); return index >= 0 ? argv[index + 1] : undefined; };
  try {
    if (!argv.includes('--json')) throw new Error('JSON_REQUIRED');
    if (argv[0] !== 'verify') throw new Error('UNSUPPORTED_PAINT_COMMAND');
    const file = option('--file');
    const width = Number(option('--width'));
    const height = Number(option('--height'));
    if (!file) throw new Error('ARTIFACT_PATH_REQUIRED');
    if (!Number.isInteger(width) || width < 1 || !Number.isInteger(height) || height < 1) throw new Error('INVALID_EXPECTED_DIMENSIONS');
    const result = verifyPng(file, { width, height });
    out(JSON.stringify(result, null, 2));
    return result.valid ? 0 : 1;
  } catch (error) {
    out(JSON.stringify({ error: error.message, usage: USAGE }, null, 2));
    return 1;
  }
}
