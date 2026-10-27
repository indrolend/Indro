#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const [command, ...args] = process.argv.slice(2);

const HELP = `Indro · semantic software-development language

Language:
  indro compile <program.indro|program.i> [compiler options]
  indro proof-plan <proof...> --state <state.json> [--cache <cache.json>]
  indro language-test
  indro work inspect <path>
  indro work compare <left> <right>
  indro work evidence <id>
  indro app help
  indro app fixture set <number> --json  # offline fixture
  indro capability list --json
  indro capability retain-paint --artifact PATH --width N --height N --app-version VERSION --json
  indro capability validate <id> --json
  indro capability invoke <id> --value 0..1 --verify --authorize-write --json
  indro paint verify --file PATH --width N --height N --json
  indro fl doctor --json
  indro fl plugin set --channel N --param N --value 0..1 --verify --json
  indro verify-native --root PATH --build PATH --store PATH [--declare-runtime-closure]
  indro godot replay --scenario smoke [--capture]
  indro ndra repo --self-test
  indro ndra repo --workspace PATH --output PATH [--repos toolz boltons ...]

Execution and evidence (CommandHUD compatibility):
  indro shell | tui | desktop
  indro run -- <command>
  indro state --json
  indro search <query> [scope]
  indro history [count]

Short alias: i
Compatibility aliases: hud, commandhud`;

function python(script, forwarded) {
  const candidates = process.platform === 'win32'
    ? [['py', ['-3']], ['python', []]]
    : [['python3', []], ['python', []]];
  for (const [executable, prefix] of candidates) {
    const result = spawnSync(executable, [...prefix, script, ...forwarded], { stdio: 'inherit' });
    if (!result.error || result.error.code !== 'ENOENT') return result.status ?? 1;
  }
  console.error('INDRO_ERROR Python 3 is required for language compilation and proof planning.');
  return 2;
}

if (command === 'help' || command === '--help' || command === '-h') {
  console.log(HELP);
} else if (command === 'compile') {
  if (!args.length) {
    console.error('INDRO_ERROR compile requires a .indro or .i source file.');
    process.exitCode = 2;
  } else {
    process.exitCode = python(path.join(here, 'indro_lang.py'), args);
  }
} else if (command === 'proof-plan') {
  process.exitCode = python(path.join(here, 'indro_proof.py'), args);
} else if (command === 'work') {
  const { runWorkbench } = await import('./workbench.mjs');
  process.exitCode = await runWorkbench(args);
} else if (command === 'app') {
  const { runAppCli } = await import('./uai/cli.mjs');
  process.exitCode = await runAppCli(args);
} else if (command === 'fl') {
  const { runFlCli } = await import('./fl/cli.mjs');
  process.exitCode = await runFlCli(args);
} else if (command === 'paint') {
  const { runPaintCli } = await import('./paint/cli.mjs');
  process.exitCode = await runPaintCli(args);
} else if (command === 'capability') {
  const { runCapabilityCli } = await import('./capability/cli.mjs');
  process.exitCode = await runCapabilityCli(args);
} else if (command === 'verify-native') {
  const { runNativeCli } = await import('./native-verify.mjs');
  process.exitCode = runNativeCli(args);
} else if (command === 'godot') {
  if (args[0] !== 'replay') {
    console.error('INDRO_ERROR godot currently supports replay only.');
    process.exitCode = 2;
  } else {
    const { runGodotCli } = await import('./godot-replay.mjs');
    process.exitCode = await runGodotCli(args);
  }
} else if (command === 'ndra') {
  const scoped = args[0] === 'repo' && args.includes('--workspace') && args.includes('--output');
  const selfTest = args.length === 2 && args[0] === 'repo' && args[1] === '--self-test';
  if (!scoped && !selfTest) {
    console.error('INDRO_ERROR ndra repo requires --workspace PATH and --output PATH (or --self-test).');
    process.exitCode = 2;
  } else {
    process.exitCode = python(path.join(here, 'tools', 'ndra_repo_gauntlet.py'), args.slice(1));
  }
} else if (command === 'language-test') {
  process.exitCode = python(path.join(here, 'tools', 'test-all.py'), args);
} else {
  await import('../commandhud/cli.mjs');
}
