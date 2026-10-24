import { executeTransaction } from './transaction.mjs';

export async function runAppCli(argv, out = console.log, err = console.error) {
  const [command, ...rest] = argv;
  if (command === 'help' || !command) {
    out('indro app fixture set <number> [--json]  # offline transaction test only');
    return 0;
  }
  if (command !== 'fixture' || rest[0] !== 'set' || !Number.isFinite(Number(rest[1])) || rest[1] === undefined) {
    err('INDRO_ERROR Unsupported app command. Run: indro app help');
    return 2;
  }
  const value = Number(rest[1]);
  let state = 0.5554;
  const adapter = {
    name: 'offline-fixture',
    observe: async () => ({ value: state }),
    invoke: async (_target, _capability, args) => {
      state = args.value;
      return { milestones: { EXECUTED: true } };
    }
  };
  const receipt = await executeTransaction({
    target: { app_id: 'fixture', process_id: 0 },
    capability: { id: 'parameter.value' },
    args: { value }, adapter
  });
  out(JSON.stringify(receipt, null, rest.includes('--json') ? 2 : 0));
  return receipt.verdict === 'STATE_CONFIRMED' ? 0 : 1;
}
