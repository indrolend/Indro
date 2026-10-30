import { randomUUID } from 'node:crypto';
import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

export const PIANO_ROLL_SCHEMA = 'indro.fl.piano-roll.v1';

export function noteFromStep({ step, number = 60, velocity = 100, lengthSteps = 1 }, ppq) {
  for (const [name, value, minimum, maximum] of [
    ['step', step, 1, 4096], ['number', number, 0, 131], ['velocity', velocity, 1, 127],
    ['lengthSteps', lengthSteps, 1, 256], ['ppq', ppq, 1, 9600],
  ]) {
    if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new Error(`INVALID_${name.toUpperCase()}`);
  }
  if (ppq % 4 !== 0) throw new Error('PPQ_NOT_DIVISIBLE_BY_SIXTEENTH_STEP');
  const ticks = ppq / 4;
  return { number, time: (step - 1) * ticks, length: lengthSteps * ticks, velocity: velocity / 127 };
}

export function renderPianoRollScript({ requestId = randomUUID(), operation, note }) {
  if (!['note.add', 'note.inspect'].includes(operation)) throw new Error('PIANO_ROLL_OPERATION_UNSUPPORTED');
  if (!/^[0-9a-f-]{36}$/i.test(requestId)) throw new Error('REQUEST_ID_INVALID');
  for (const field of ['number', 'time', 'length', 'velocity']) if (!Number.isFinite(note?.[field])) throw new Error('NOTE_INVALID');
  return `import flpianoroll as flp

REQUEST_ID = ${JSON.stringify(requestId)}
OPERATION = ${JSON.stringify(operation)}
EXPECTED = ${JSON.stringify(note)}

def _same(note):
    return (int(note.number) == EXPECTED["number"] and int(note.time) == EXPECTED["time"] and
            int(note.length) == EXPECTED["length"] and
            abs(float(note.velocity) - EXPECTED["velocity"]) <= (1.0 / 127.0))

def apply(form=None):
    before = [flp.score.getNote(index) for index in range(flp.score.noteCount)]
    before_matches = sum(1 for note in before if _same(note))
    if OPERATION == "note.add" and before_matches == 0:
        note = flp.Note()
        note.number = EXPECTED["number"]
        note.time = EXPECTED["time"]
        note.length = EXPECTED["length"]
        note.velocity = EXPECTED["velocity"]
        flp.score.addNote(note)
    after = [flp.score.getNote(index) for index in range(flp.score.noteCount)]
    matches = sum(1 for note in after if _same(note))
    outcome = "CONFIRMED" if matches > 0 else "CONTRADICTED"
    flp.Utils.ShowMessage("INDRO_RESULT|" + REQUEST_ID + "|" + outcome +
        "|before=" + str(len(before)) + "|after=" + str(len(after)) +
        "|matches=" + str(matches) + "|ppq=" + str(flp.score.PPQ))
`;
}

export function parsePianoRollResult(text, requestId) {
  const escaped = requestId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = String(text).match(new RegExp(`INDRO_RESULT\\|${escaped}\\|(CONFIRMED|CONTRADICTED)\\|before=(\\d+)\\|after=(\\d+)\\|matches=(\\d+)\\|ppq=(\\d+)`));
  if (!match) throw new Error('PIANO_ROLL_RESULT_IDENTITY_INVALID');
  return { outcome: match[1], beforeCount: Number(match[2]), afterCount: Number(match[3]), matches: Number(match[4]), ppq: Number(match[5]) };
}

export function defaultPianoRollScriptPath() {
  return join(homedir(), 'Documents', 'Image-Line', 'FL Studio', 'Settings', 'Piano roll scripts', 'INDRO Note.pyscript');
}

export function installPianoRollRequest(spec, { path = defaultPianoRollScriptPath() } = {}) {
  const destination = resolve(path);
  mkdirSync(dirname(destination), { recursive: true });
  const temporary = `${destination}.${process.pid}.${randomUUID()}.tmp`;
  const source = renderPianoRollScript(spec);
  writeFileSync(temporary, source, { flag: 'wx' });
  renameSync(temporary, destination);
  return { path: destination, bytes: Buffer.byteLength(source) };
}

async function bridgeStatus(transport) {
  const exchange = await transport.request('status', { arguments: {}, target: {}, authorization: 'read-only' });
  if (exchange.response.error) throw new Error(exchange.response.error);
  return exchange.response.result;
}

function validateTarget(status, target) {
  if (status.selected?.channel !== target.channel || status.selected?.channel_name !== target.channel_name ||
      status.pattern?.pattern !== target.pattern) throw new Error('PIANO_ROLL_TARGET_IDENTITY_CHANGED');
  return { selected: status.selected, pattern: status.pattern, bridge: status.bridge };
}

export function createPianoRollAdapter({ bridgeTransport, desktopTransport, scriptPath } = {}) {
  if (!bridgeTransport?.request || !desktopTransport?.request) throw new TypeError('Bridge and desktop transports are required');
  async function run(target, note, operation) {
    const identityBefore = validateTarget(await bridgeStatus(bridgeTransport), target);
    const requestId = randomUUID();
    const installed = installPianoRollRequest({ requestId, operation, note }, { path: scriptPath });
    const started = Date.now();
    const exchange = await desktopTransport.request('fl-studio.piano-roll.run', { request_id: requestId });
    if (!exchange.response.ok) {
      const error = new Error(exchange.response.error || 'PIANO_ROLL_DESKTOP_OPERATION_FAILED');
      error.transactionId = requestId;
      throw error;
    }
    const result = parsePianoRollResult(exchange.response.result?.result_text, requestId);
    const identityAfter = validateTarget(await bridgeStatus(bridgeTransport), target);
    return { result, identityBefore, identityAfter, installed, durationMs: Date.now() - started,
      trigger: exchange.response.result?.trigger, application: exchange.response.result?.application };
  }
  return {
    name: 'indro-fl-piano-roll-native-script',
    async observe(target, capabilityId) {
      if (capabilityId !== 'fl.piano-roll.note') throw new Error('PIANO_ROLL_CAPABILITY_INVALID');
      const execution = await run(target, target.note, 'note.inspect');
      if (execution.result.ppq !== target.ppq) throw new Error('PIANO_ROLL_PPQ_CHANGED');
      return { value: execution.result.outcome === 'CONFIRMED', matches: execution.result.matches,
        note_count: execution.result.afterCount, ppq: execution.result.ppq,
        target: execution.identityAfter, observation_source: 'flpianoroll.score.getNote', execution };
    },
    async invoke(target, capability) {
      if (capability.id !== 'fl.piano-roll.note') return { error: 'PIANO_ROLL_CAPABILITY_INVALID' };
      const execution = await run(target, target.note, 'note.add');
      return { milestones: { RECEIVED: true, ACCEPTED: true, EXECUTED: true },
        native_outcome: execution.result.outcome, execution };
    },
  };
}
