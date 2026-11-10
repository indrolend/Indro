import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { godotReplayClaims, recognizesGodotReplayObjective, requireConfirmedClipboardResult, retainedReplayOptions, runGodotReplayObjective, resolveExecutable, validateReplay, validateReplayArtifacts } from './godot-replay.mjs';
import { resolveObjective, selectWorkflowCandidate } from './objective-resolution.mjs';

const png = Buffer.from('89504e470d0a1a0a0000000d494844520000000100000001', 'hex');
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
test('selects only objective-required Godot proof claims', () => {
  assert.deepEqual(godotReplayClaims('Verify the current Godot gameplay replay.'), ['behavior', 'visual', 'artifacts']);
  assert.deepEqual(godotReplayClaims('Verify Godot replay behavior.'), ['behavior']);
  assert.deepEqual(godotReplayClaims('Check Godot replay visual appearance.'), ['behavior', 'visual']);
  assert.deepEqual(godotReplayClaims('Verify Godot replay video continuity.'), ['behavior', 'continuity']);
});
test('behavior-only reuse skips damaged visual evidence while visual proof rejects it', () => {
  const value = fixture();
  writeFileSync(path.join(value.captureDir, 'frame-001-tick-000000.png'), 'tampered');
  writeFileSync(path.join(path.dirname(value.captureDir), 'stdout.log'), value.stdout);
  writeFileSync(path.join(path.dirname(value.captureDir), 'stderr.log'), value.stderr);
  writeFileSync(path.join(path.dirname(value.captureDir), 'exit-code.txt'), `${value.exitCode}\n`);
  const resultPath = path.join(path.dirname(value.captureDir), 'retained.txt');
  writeFileSync(resultPath, `INDRO_GODOT_REPLAY_RESULT=${JSON.stringify({ directory: path.dirname(value.captureDir), zipPath: 'unused', zipSha256: 'unused', video: null })}\n`);
  const record = { stdoutPath: resultPath };
  assert.equal(validateReplayArtifacts(record, commands, ['behavior']).valid, true);
  assert.match(validateReplayArtifacts(record, commands, ['behavior', 'visual']).reasons.join(), /CAPTURE_FILE_INVALID/);
  assert.match(validateReplayArtifacts(record, commands, ['behavior', 'continuity']).reasons.join(), /MISSING_REPLAY_VIDEO/);
});

test('resolves a Godot replay objective from retained workflow identity', async () => {
  const options = { scenario: 'smoke', commands: null, capture: true, clipboard: false, clipboardImage: false, video: false };
  const payload = Buffer.from(JSON.stringify({ options, dependencies: {} })).toString('base64url');
  const record = {
    id: 'historical-replay',
    status: 'pass', exitCode: 0,
    operation: { reusableEvidence: { descriptor: { identity: 'indro/godot/replay', argv: ['node', 'godot-replay.mjs', '--execute-replay-worker', payload] } } },
  };
  let received = null;
  const resolution = await runGodotReplayObjective('Verify the current Godot gameplay replay.', {
    project: process.cwd(),
    resolveGodotProject: (value) => value,
    resolveProject: async () => ({ root: process.cwd() }),
    listRuns: () => [{ id: 'other' }, record],
    replay: async (value) => { received = value; return { cacheDecision: 'reused' }; },
  });
  assert.equal(recognizesGodotReplayObjective('check Godot replay'), true);
  assert.deepEqual(retainedReplayOptions(record), options);
  assert.deepEqual(received, options);
  assert.equal(resolution.selectedRunId, record.id);
  assert.equal(resolution.result.cacheDecision, 'reused');
});

test('objective resolution fails closed without a retained replay workflow', async () => {
  await assert.rejects(() => runGodotReplayObjective('Verify the current Godot gameplay replay.', {
    project: process.cwd(), resolveGodotProject: (value) => value, resolveProject: async () => ({ root: process.cwd() }), listRuns: () => [],
  }), /No retained Godot replay workflow/);
  await assert.rejects(() => runGodotReplayObjective('build everything', { project: process.cwd() }), /No verified workflow matches/);
});

test('video objective upgrades a retained replay workflow to collect missing continuity proof', async () => {
  const options = { scenario: 'smoke', commands: null, capture: true, clipboard: false, clipboardImage: false, video: false };
  const payload = Buffer.from(JSON.stringify({ options, dependencies: {} })).toString('base64url');
  const record = { id: 'replay-without-video', status: 'pass', exitCode: 0, operation: { reusableEvidence: { descriptor: { identity: 'indro/godot/replay', argv: ['node', 'godot-replay.mjs', '--execute-replay-worker', payload] } } } };
  let received = null;
  const resolution = await resolveObjective('Verify Godot replay video continuity.', {
    resolveProject: async () => ({ root: process.cwd() }), records: [record],
    replay: async (value, dependencies) => { received = { value, claims: dependencies.requiredClaims }; return { validation: { observations: [], assertions: [], captures: [] } }; },
  });
  assert.equal(resolution.workflow, 'indro/godot/replay');
  assert.equal(received.value.video, true);
  assert.deepEqual(received.claims, ['behavior', 'continuity']);
});

test('shared objective selection rejects absent candidates and ranks eligible cost', async () => {
  const slow = { id: 'slow', evidenceId: 'a', confidence: 100, expectedCostMs: 500, execute: async () => 'slow' };
  const fast = { id: 'fast', evidenceId: 'b', confidence: 100, expectedCostMs: 50, execute: async () => 'fast' };
  assert.equal(selectWorkflowCandidate([null, slow, fast]), fast);
  const resolution = await resolveObjective('verify', { resolveProject: async () => ({ root: process.cwd() }), records: [], candidates: [slow, fast] });
  assert.equal(resolution.workflow, 'fast');
  assert.equal(resolution.result, 'fast');
  await assert.rejects(() => resolveObjective('unknown', { resolveProject: async () => ({ root: process.cwd() }), records: [], candidates: [] }), /No eligible verified workflow/);
});

test('objective history recovery starts bounded and expands only when required', async () => {
  const calls = [];
  const records = Array.from({ length: 20 }, (_, index) => ({ id: `run-${index}` }));
  const selected = { id: 'bounded', evidenceId: 'run-12', confidence: 100, expectedCostMs: 1, execute: async () => 'ok' };
  const resolution = await resolveObjective('custom objective', {
    resolveProject: async () => ({ root: process.cwd() }),
    listRuns: (_project, limit) => { calls.push(limit); return records.slice(0, limit); },
    discoverGodot: async (_objective, { records: visible }) => visible.length >= 13 ? selected : null,
    discoverNative: () => null,
    searchLimit: 100,
  });
  assert.deepEqual(calls, [10, 100]);
  assert.equal(resolution.workflow, 'bounded');
});
