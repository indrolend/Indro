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
} else if (command === 'language-test') {
  process.exitCode = python(path.join(here, 'tools', 'test-all.py'), args);
} else {
  await import('../commandhud/cli.mjs');
}
