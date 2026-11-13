import { validateDevelopmentReceipt } from './receipt.mjs';

export async function runDevelopmentCli(args, out = console.log, error = console.error) {
  const [verb, ...rest] = args, marker = rest.indexOf('--receipt');
  if (verb !== 'validate' || marker < 0 || !rest[marker + 1]) { error('INDRO_ERROR Usage: indro development validate --receipt PATH --json'); return 2; }
  const result = validateDevelopmentReceipt(rest[marker + 1]);
  out(JSON.stringify(result, null, rest.includes('--json') ? 2 : 0));
  return result.valid ? 0 : 1;
}
