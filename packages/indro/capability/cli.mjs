import { invokeCapability, listCapabilities, loadCapability, retainFlParameterCapability, validateCapability } from './store.mjs';

const USAGE = `indro capability list --json
indro capability retain-fl --latest --json
indro capability inspect <id> --json
indro capability validate <id> --json
indro capability invoke <id> --value 0..1 --verify --authorize-write [--validation-snapshot] --json`;

export async function runCapabilityCli(argv, out = console.log, err = console.error, dependencies = {}) {
  const words = argv.filter(value => !value.startsWith('--'));
  const has = flag => argv.includes(flag);
  const option = name => { const index = argv.indexOf(name); return index >= 0 ? argv[index + 1] : undefined; };
  try {
    if (!has('--json')) throw new Error('JSON_REQUIRED');
    if (words[0] === 'list' && words.length === 1) { out(JSON.stringify({ capabilities: listCapabilities(dependencies) }, null, 2)); return 0; }
    if (words[0] === 'retain-fl' && has('--latest')) { out(JSON.stringify(retainFlParameterCapability(dependencies), null, 2)); return 0; }
    const id = words[1];
    if (!id) throw new Error('CAPABILITY_ID_REQUIRED');
    if (words[0] === 'inspect') { out(JSON.stringify(loadCapability(id, dependencies), null, 2)); return 0; }
    if (words[0] === 'validate') { const value = await validateCapability(id, dependencies); out(JSON.stringify(value, null, 2)); return value.valid ? 0 : 1; }
    if (words[0] === 'invoke') {
      if (!has('--verify')) throw new Error('CAPABILITY_WRITE_REQUIRES_VERIFY');
      const result = await invokeCapability(id, Number(option('--value')), { ...dependencies,
        authorization: has('--authorize-write') ? 'explicit-user-write' : null,
        validationSnapshot: has('--validation-snapshot') });
      out(JSON.stringify(result, null, 2)); return result.code;
    }
    throw new Error('UNSUPPORTED_CAPABILITY_COMMAND');
  } catch (error) {
    out(JSON.stringify({ error: error.message, usage: USAGE }, null, 2));
    return 1;
  }
}
