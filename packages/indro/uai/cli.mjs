import { executeTransaction } from './transaction.mjs';
import { runSpawnedPriority } from './process-priority.mjs';

export async function runAppCli(argv, out = console.log, err = console.error) {
  const [command, ...rest] = argv;
  if (command === 'help' || !command) {
    out('indro app fixture set <number> [--json]  # offline transaction test only');
    out('indro app process priority --spawn --set BelowNormal --json');
    return 0;
  }
  if (command === 'process') {
    const expected = ['priority', '--spawn', '--set', 'BelowNormal', '--json'];
    if (rest.length !== expected.length || rest.some((value, index) => value !== expected[index])) {
      err('INDRO_ERROR Usage: indro app process priority --spawn --set BelowNormal --json');
      return 2;
    }
    try {
      const result = await runSpawnedPriority({ value: 'BelowNormal' });
      out(JSON.stringify(result, null, 2));
      return result.transaction.verdict === 'STATE_CONFIRMED' && result.cleanup.confirmed ? 0 : 1;
    } catch (error) {
      err(`INDRO_ERROR ${error?.message ?? error}`);
      return 1;
    }
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
