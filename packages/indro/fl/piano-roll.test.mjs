import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createPianoRollAdapter, installPianoRollRequest, noteFromStep, parsePianoRollResult, renderPianoRollScript } from './piano-roll.mjs';

const id = '22222222-2222-4222-8222-222222222222';

test('semantic sixteenth step compiles to exact Piano Roll ticks and normalized velocity', () => {
  assert.deepEqual(noteFromStep({ step: 7, number: 60, velocity: 100, lengthSteps: 1 }, 96), {
    number: 60, time: 144, length: 24, velocity: 100 / 127,
  });
});

test('generated native script is nonce-bound, idempotent, and observes post-state', () => {
  const note = noteFromStep({ step: 7, number: 60, velocity: 100, lengthSteps: 1 }, 96);
  const source = renderPianoRollScript({ requestId: id, operation: 'note.add', note });
  assert.match(source, /score\.addNote/);
  assert.match(source, /before_matches == 0/);
  assert.match(source, /INDRO_RESULT/);
  const path = join(mkdtempSync(join(tmpdir(), 'indro-piano-roll-')), 'INDRO Note.pyscript');
  installPianoRollRequest({ requestId: id, operation: 'note.add', note }, { path });
  assert.equal(readFileSync(path, 'utf8'), source);
});

test('native result parser requires the exact request identity and preserves contradiction', () => {
  assert.deepEqual(parsePianoRollResult(`INDRO_RESULT|${id}|CONFIRMED|before=4|after=5|matches=1|ppq=96`, id), {
    outcome: 'CONFIRMED', beforeCount: 4, afterCount: 5, matches: 1, ppq: 96,
  });
  assert.equal(parsePianoRollResult(`INDRO_RESULT|${id}|CONTRADICTED|before=4|after=4|matches=0|ppq=96`, id).outcome, 'CONTRADICTED');
  assert.throws(() => parsePianoRollResult('INDRO_RESULT|wrong|CONFIRMED|before=0|after=1|matches=1|ppq=96', id), /IDENTITY/);
});

test('adapter revalidates channel and pattern around native score observation and mutation', async () => {
  const note = noteFromStep({ step: 7, number: 60, velocity: 100, lengthSteps: 1 }, 96);
  const target = { app_id: 'fl-studio', channel: 0, channel_name: '808 Kick', pattern: 1, ppq: 96, note };
  const root = mkdtempSync(join(tmpdir(), 'indro-piano-adapter-'));
  const bridgeTransport = { async request() { return { response: { result: {
    selected: { channel: 0, channel_name: '808 Kick' }, pattern: { pattern: 1, pattern_name: 'Pattern 1' },
    bridge: { session_id: 'session-1' },
  } } }; } };
  let nativeOutcome = 'CONTRADICTED';
  const desktopTransport = { async request(_operation, args) { return { response: { ok: true, result: {
    result_text: `INDRO_RESULT|${args.request_id}|${nativeOutcome}|before=4|after=${nativeOutcome === 'CONFIRMED' ? 5 : 4}|matches=${nativeOutcome === 'CONFIRMED' ? 1 : 0}|ppq=96`,
    trigger: 'fixture', application: { process_id: 42 },
  } } }; } };
  const adapter = createPianoRollAdapter({ bridgeTransport, desktopTransport, scriptPath: join(root, 'INDRO Note.pyscript') });
  assert.equal((await adapter.observe(target, 'fl.piano-roll.note')).value, false);
  nativeOutcome = 'CONFIRMED';
  assert.equal((await adapter.invoke(target, { id: 'fl.piano-roll.note' })).native_outcome, 'CONFIRMED');
  assert.equal((await adapter.observe(target, 'fl.piano-roll.note')).value, true);
});
