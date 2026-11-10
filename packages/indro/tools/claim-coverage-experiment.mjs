import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

const root = path.resolve(process.argv[2] || '');
const trials = Number(process.argv[3] || 25);
if (!root || !existsSync(root) || !Number.isInteger(trials) || trials < 1) {
  console.error('Usage: node claim-coverage-experiment.mjs <replay-directory> [trials]');
  process.exit(2);
}

const files = {
  observations: path.join(root, 'observations.json'), assertions: path.join(root, 'assertions.json'),
  exitCode: path.join(root, 'exit-code.txt'), video: path.join(root, 'replay.mp4'),
};
const capture = path.join(root, 'captures', readdirSync(path.join(root, 'captures')).filter((name) => name.endsWith('.png')).sort()[0]);
const original = {
  observations: readFileSync(files.observations), assertions: readFileSync(files.assertions),
  exitCode: readFileSync(files.exitCode), capture: readFileSync(capture), video: files.video,
};

function behavior(value) {
  try {
    const observations = JSON.parse(value.observations);
    const assertions = JSON.parse(value.assertions);
    const verdict = Number(String(value.exitCode).trim()) === 0 && observations.length > 0 && assertions.length > 0
      && assertions.every((item) => String(item.raw || '').startsWith('AGENT_ASSERT_PASS'));
    return { verdict, bytes: value.observations.length + value.assertions.length + value.exitCode.length, processes: 0 };
  } catch { return { verdict: false, bytes: value.observations.length + value.assertions.length + value.exitCode.length, processes: 0 }; }
}
function frame(value) {
  return { verdict: value.capture?.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) || false, bytes: value.capture?.length || 0, processes: 0 };
}
function continuity(value) {
  if (!value.video || !existsSync(value.video)) return { verdict: false, bytes: 0, processes: 0 };
  const result = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', value.video], { encoding: 'utf8', windowsHide: true });
  return { verdict: !result.error && result.status === 0 && Number(result.stdout.trim()) > 0, bytes: statSync(value.video).size, processes: 1 };
}
const validators = {
  behavior,
  frame,
  continuity,
  full(value) {
    const fragments = [behavior(value), frame(value), continuity(value)];
    return { verdict: fragments.every((item) => item.verdict), bytes: fragments.reduce((sum, item) => sum + item.bytes, 0), processes: fragments.reduce((sum, item) => sum + item.processes, 0) };
  },
};
const variants = {
  valid: original,
  corrupt_observation: { ...original, observations: Buffer.from('{') },
  corrupt_png: { ...original, capture: Buffer.from('not-png') },
  missing_video: { ...original, video: path.join(root, 'missing.mp4') },
};
function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}
const results = {};
for (const [variant, value] of Object.entries(variants)) {
  results[variant] = {};
  for (const [claim, validator] of Object.entries(validators)) {
    const samples = [];
    let observation = null;
    for (let index = 0; index < trials; index += 1) {
      const started = performance.now();
      observation = validator(value);
      samples.push(performance.now() - started);
    }
    results[variant][claim] = { verdict: observation.verdict, medianMs: median(samples), bytesInspected: observation.bytes, processes: observation.processes };
  }
}
console.log(JSON.stringify({
  schema: 'indro.claim-coverage-experiment/v1', replay: root, trials,
  claims: {
    behavior: 'simulation produced observations and declared assertions passed',
    frame: 'a selected captured frame is a PNG',
    continuity: 'the retained video has positive decoded-container duration',
    full: 'all three claims hold',
  },
  results,
  limits: [
    'This experiment measures evidence-fragment selection, not semantic image understanding.',
    'Byte counts are artifact sizes attributed to each validator, not operating-system physical I/O.',
    'A positive video duration establishes container continuity evidence, not gameplay correctness.',
  ],
}, null, 2));
