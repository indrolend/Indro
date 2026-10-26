import test from 'node:test';
import assert from 'node:assert/strict';
import { runAppCli } from './cli.mjs';

test('process priority command rejects non-canonical and unsafe argument shapes', async () => {
  for (const args of [
    ['process', 'priority', '--set', 'BelowNormal', '--json'],
    ['process', 'priority', '--spawn', '--set', 'Normal', '--json'],
    ['process', 'priority', '--spawn', '--set', 'BelowNormal', '--json', '--pid', '1']
  ]) {
    const errors = [];
    assert.equal(await runAppCli(args, () => {}, value => errors.push(value)), 2);
    assert.match(errors.join('\n'), /Usage/);
  }
});
