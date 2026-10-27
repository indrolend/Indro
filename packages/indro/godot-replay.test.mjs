import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { requireConfirmedClipboardResult, resolveExecutable, validateReplay } from './godot-replay.mjs';
import { png as validPng } from './paint/png-fixture.test-helper.mjs';

const png = validPng(1, 1);
const commands = 'observe\nstep frames=1\nassert room=1\n';

function fixture(overrides = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'indro-godot-test-'));
  const captures = path.join(root, 'captures');
  mkdirSync(captures);
  for (let index = 0; index < 3; index += 1) writeFileSync(path.join(captures, `frame-00${index}-tick-00000${index === 2 ? 1 : 0}.png`), png);
  const stdout = [
    'Godot Engine v4.7.2.stable.official.ed1daf0bf',
    'AGENT_PLAYTEST_READY schema=4 fixed_dt=0.016666667',
    'AGENT_STATE schema=4 command_id=uncommanded frame=0 room=1 frame_capture=1 frame_file="a.png"',
    'AGENT_STATE schema=4 command_id=cmd-0000 frame=0 room=1 frame_capture=1 frame_file="b.png"',
    'AGENT_STATE schema=4 command_id=cmd-0001 frame=1 room=1 frame_capture=1 frame_file="c.png"',
    'AGENT_ASSERT_PASS frame=1 expectations="room=1"',
    'AGENT_PLAYTEST_EOF frame=1',
  ].join('\n');
  return { stdout, stderr: '', exitCode: 0, captureDir: captures, commandsText: commands, ...overrides };
}

test('accepts complete schema-4 smoke evidence', () => assert.equal(validateReplay(fixture()).valid, true));
test('rejects missing protocol output despite exit zero', () => assert.deepEqual(validateReplay(fixture({ stdout: '' })).errors, ['MISSING_OR_INVALID_READY', 'MISSING_OBSERVATIONS', 'MISSING_SUCCESSFUL_TERMINATION', 'ASSERTION_RESULTS_INCOMPLETE', 'CAPTURE_COUNT_MISMATCH']));
test('rejects failed assertion', () => { const value = fixture(); value.stdout = value.stdout.replace('AGENT_ASSERT_PASS frame=1 expectations="room=1"', 'AGENT_PLAYTEST_ERROR reason=assertion_failed'); value.exitCode = 4; assert.match(validateReplay(value).errors.join(), /EXIT_CODE_4.*PROTOCOL_ERROR.*ASSERTION_RESULTS_INCOMPLETE/); });
test('rejects missing screenshot', () => { const value = fixture(); value.captureDir = path.join(value.captureDir, 'missing'); assert.match(validateReplay(value).errors.join(), /CAPTURE_COUNT_MISMATCH/); });
test('rejects tampered PNG bytes', () => { const value = fixture(); writeFileSync(path.join(value.captureDir, 'frame-001-tick-000000.png'), 'tampered'); assert.match(validateReplay(value).errors.join(), /CAPTURE_FILE_INVALID/); });
test('rejects malformed command protocol result', () => { const value = fixture(); value.stdout = value.stdout.replace('AGENT_ASSERT_PASS frame=1 expectations="room=1"', 'AGENT_PLAYTEST_ERROR reason=unknown_command'); value.exitCode = 2; assert.match(validateReplay(value).errors.join(), /PROTOCOL_ERROR/); });
test('rejects absent EOF', () => { const value = fixture(); value.stdout = value.stdout.replace('AGENT_PLAYTEST_EOF frame=1', ''); assert.match(validateReplay(value).errors.join(), /MISSING_SUCCESSFUL_TERMINATION/); });
test('rejects a missing executable explicitly', () => assert.throws(() => resolveExecutable('godot_console.exe', path.join(os.tmpdir(), 'definitely-missing-godot.exe')), /does not exist/));
test('rejects clipboard failure without confirmation', () => assert.throws(() => requireConfirmedClipboardResult({ status: 1, stdout: '', stderr: 'clipboard unavailable' }), /Clipboard transfer failed/));

test('rejects signature-only truncated PNG even when capture count and protocol agree', () => {
  const value = fixture();
  writeFileSync(path.join(value.captureDir, 'frame-001-tick-000000.png'), Buffer.from('89504e470d0a1a0a0000000d494844520000000100000001', 'hex'));
  assert.ok(validateReplay(value).errors.includes('CAPTURE_FILE_INVALID'));
});
