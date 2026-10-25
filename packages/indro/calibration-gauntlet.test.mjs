import assert from 'node:assert/strict';
import test from 'node:test';
import { runNegativeControls } from './calibration-gauntlet.mjs';

test('calibration negative controls fail closed', () => {
  const controls = runNegativeControls();
  assert.equal(controls.length, 6);
  assert.equal(controls.every((control) => control.correct), true, JSON.stringify(controls));
  assert.equal(controls.some((control) => control.actualAccepted), false);
});
