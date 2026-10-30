import { invokeCapability, listCapabilities, loadCapability, observeCapability, retainFlBrowserCapability, retainFlParameterCapability, retainFlPianoRollCapability, retainPaintResizeCapability, validateCapability } from './store.mjs';

const USAGE = `indro capability list --json
indro capability retain-fl --latest --json
indro capability retain-fl-note --latest --json
indro capability retain-fl-browser --response PATH --independent PATH --json
indro capability retain-paint --artifact PATH --width N --height N --app-version VERSION --json
indro capability inspect <id> --json
indro capability validate <id> --json
indro capability observe <id> --json
indro capability invoke <id> --value 0..1 --verify --authorize-write [--validation-snapshot] --json`;

export async function runCapabilityCli(argv, out = console.log, err = console.error, dependencies = {}) {
  const words = argv.filter(value => !value.startsWith('--'));
  const has = flag => argv.includes(flag);
  const option = name => { const index = argv.indexOf(name); return index >= 0 ? argv[index + 1] : undefined; };
  try {
    if (!has('--json')) throw new Error('JSON_REQUIRED');
    if (words[0] === 'list' && words.length === 1) { out(JSON.stringify({ capabilities: listCapabilities(dependencies) }, null, 2)); return 0; }
    if (words[0] === 'retain-fl' && has('--latest')) { out(JSON.stringify(retainFlParameterCapability(dependencies), null, 2)); return 0; }
    if (words[0] === 'retain-fl-note' && has('--latest')) { out(JSON.stringify(retainFlPianoRollCapability(dependencies), null, 2)); return 0; }
    if (words[0] === 'retain-fl-browser') {
      out(JSON.stringify(retainFlBrowserCapability({ ...dependencies, responsePath: option('--response'),
        independentObservationPath: option('--independent') }), null, 2)); return 0;
    }
    if (words[0] === 'retain-paint') {
      const retained = retainPaintResizeCapability({ ...dependencies, artifactPath: option('--artifact'),
        width: Number(option('--width')), height: Number(option('--height')), appVersion: option('--app-version') });
      out(JSON.stringify(retained, null, 2)); return 0;
    }
    const id = words[1];
    if (!id) throw new Error('CAPABILITY_ID_REQUIRED');
    if (words[0] === 'inspect') { out(JSON.stringify(loadCapability(id, dependencies), null, 2)); return 0; }
    if (words[0] === 'validate') { const value = await validateCapability(id, { ...dependencies, paintAppVersion: option('--app-version') }); out(JSON.stringify(value, null, 2)); return value.valid ? 0 : 1; }
    if (words[0] === 'observe') { out(JSON.stringify(await observeCapability(id, dependencies), null, 2)); return 0; }
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
