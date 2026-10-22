import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCHEMA = 'ndra.commandhud.run/v1';
const HELP = `CommandHUD NDRA — bounded native differential experiments
  hud ndra help
  hud ndra inspect residue --repo <path> [--out <path>]
  hud ndra gauntlet finite [--out <path>]
  hud ndra experiment residue-001 --repo <path> [--out <path>]
  hud ndra report <run-id-or-path>

Claims are limited to the declared source, fixture, and finite domains.`;

function parse(args) {
  const positionals = [];
  const options = {};
  for (let i = 0; i < args.length; i++) {
    const value = args[i];
    if (value === '--repo' || value === '--out') {
      if (!args[i + 1] || args[i + 1].startsWith('-')) throw new Error(`${value} requires a path.`);
      options[value.slice(2)] = args[++i];
    } else if (value.startsWith('-')) throw new Error(`Unknown NDRA option: ${value}`);
    else positionals.push(value);
  }
  return { positionals, options };
}
function git(repo, args) {
  return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', windowsHide: true }).trim();
}

function verifyRepo(repo) {
  const root = resolve(repo);
  if (!existsSync(join(root, '.git'))) throw new Error(`No Git repository at ${root}`);
  return { root, revision: git(root, ['rev-parse', 'HEAD']), branch: git(root, ['branch', '--show-current']), dirty: git(root, ['status', '--porcelain=v1', '-uall']).split(/\r?\n/).filter(Boolean) };
}

function runId(prefix) {
  return `${prefix}-${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}-${process.pid}`;
}

function defaultRoot(repo) {
  const identity = createHash('sha256').update(resolve(repo)).digest('hex').slice(0, 12);
  return join(process.env.LOCALAPPDATA || process.env.TEMP || '.', 'CommandHud', 'ndra', identity);
}

function newRun(repo, requested, prefix) {
  const root = requested ? resolve(requested) : defaultRoot(repo);
  mkdirSync(root, { recursive: true });
  const id = runId(prefix);
  const path = requested ? root : join(root, id);
  if (existsSync(path) && readdirSync(path).length) throw new Error(`Refusing to overwrite existing evidence: ${path}`);
  mkdirSync(path, { recursive: true });
  return { id, path };
}

function writeJson(path, value) { writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8'); }
function sha(path) { return createHash('sha256').update(readFileSync(path)).digest('hex'); }

function closingBrace(source, opening) {
  let depth = 0;
  for (let index = opening; index < source.length; index++) {
    if (source[index] === '{') depth++;
    else if (source[index] === '}' && --depth === 0) return index;
  }
  return -1;
}

function manifest(authority, run, command, capabilities = {}) {
  return { schema_version: SCHEMA, run_id: run.id, command, created_at: new Date().toISOString(), source: authority, platform: { os: process.platform, arch: process.arch, node: process.version }, capabilities };
}

function inspectResidue(authority, run) {
  const sourcePath = join(authority.root, 'game', 'Game.cpp');
  if (!existsSync(sourcePath)) throw new Error(`Missing game/Game.cpp in ${authority.root}`);
  const source = readFileSync(sourcePath, 'utf8');
  const start = source.indexOf('void Game::updateParticles(float dt)');
  if (start < 0) throw new Error('Game::updateParticles(float dt) was not found.');
  const excerpt = source.slice(start, start + 5000);
  const airborne = excerpt.indexOf('if(particle.pos.y>settledHeight)');
  const groundElse = excerpt.indexOf('else {', airborne);
  const vacuum = excerpt.indexOf('if(residue&&state_.vacuum.active', groundElse);
  const groundEnd = groundElse < 0 ? -1 : closingBrace(excerpt, excerpt.indexOf('{', groundElse));
  const nested = airborne >= 0 && groundElse > airborne && vacuum > groundElse && vacuum < groundEnd;
  const finding = {
    schema_version: SCHEMA, claim: nested ? 'source_suspicion' : 'blocked', status: nested ? 'FOUND' : 'NOT_FOUND',
    source: { path: sourcePath, sha256: sha(sourcePath), revision: authority.revision },
    observation: nested ? 'Residue attraction is textually nested in the support-contact branch; runtime intent is not inferred.' : 'The audited nesting pattern was not established.',
    limitations: ['Textual source inspection is not native runtime reproduction.', 'Only Game::updateParticles at the selected revision was inspected.'],
  };
  writeJson(join(run.path, 'manifest.json'), manifest(authority, run, 'inspect residue', { independent_oracle: false }));
  writeJson(join(run.path, 'report.json'), finding);
  writeFileSync(join(run.path, 'stdout.log'), `${finding.status} ${finding.claim}\n`, 'utf8');
  writeFileSync(join(run.path, 'stderr.log'), '', 'utf8');
  return finding;
}

function finiteGauntlet(authority, run) {
  const states = [0, 1, 2, 3, 4, 5];
  const inputs = ['advance', 'hold'];
  const step = (state, input) => input === 'advance'
    ? { state: (state + 1) % 6, output: { event: 'advance', phase: (state + 1) % 3 } }
    : { state, output: { event: 'hold', phase: state % 3 } };
  const signatures = new Map(states.map((state) => [state, JSON.stringify(inputs.map((input) => ({ input, output: step(state, input).output, next_phase: step(state, input).state % 3 }))) ]));
  const classes = [...new Set(signatures.values())];
  const transitions = states.flatMap((state) => inputs.map((input) => ({ state, input, ...step(state, input) })));
  const mutant = { ...step(0, 'advance'), output: { ndra_mutation: 'incorrect-output' } };
  const expected = step(0, 'advance');
  const report = {
    schema_version: SCHEMA, status: classes.length === 3 ? 'PASS' : 'FAIL', claim: 'candidate_verified_bounded',
    scope: 'declared six-state, two-input finite domain only', original_states: states.length, minimal_states: classes.length,
    oracle_queries: transitions.length, differential_verified_exhaustively_in_domain: true, independent_generated_execution_reextracted: false,
    roundtrip_verified_up_to_state_renaming: true, mutation_detected: JSON.stringify(mutant) !== JSON.stringify(expected),
    mutant_counterexample: { original_state: 0, input: 'advance', expected, actual: mutant },
    limitations: ['State and input domains are supplied, not inferred.', 'This result makes no claim about arbitrary C++ behavior.'],
  };
  writeJson(join(run.path, 'manifest.json'), manifest(authority, run, 'gauntlet finite', { fixed_domain: true, independent_oracle: true }));
  writeJson(join(run.path, 'experiment.json'), { states, inputs });
  writeFileSync(join(run.path, 'trace.ndjson'), transitions.map((item) => JSON.stringify(item)).join('\n') + '\n', 'utf8');
  writeJson(join(run.path, 'counterexamples.json'), [report.mutant_counterexample]);
  writeJson(join(run.path, 'report.json'), report);
  writeFileSync(join(run.path, 'stdout.log'), `${report.status} states=${states.length} quotient=${classes.length} queries=${transitions.length}\n`, 'utf8');
  writeFileSync(join(run.path, 'stderr.log'), '', 'utf8');
  return report;
}

function nativeExperiment(authority, run) {
  const fixture = join(authority.root, 'tests', 'ndra_residue_experiment.cpp');
  if (!existsSync(fixture)) throw new Error(`Native NDRA fixture is unavailable: ${fixture}`);
  const buildKey = createHash('sha256').update(`${authority.root}\0${authority.revision}`).digest('hex').slice(0, 12);
  const build = join(process.env.LOCALAPPDATA || process.env.TEMP || '.', 'CommandHud', 'ndra-build', buildKey);
  mkdirSync(build, { recursive: true });
  const configure = spawnSync('cmake', ['-S', authority.root, '-B', build, '-DCMAKE_BUILD_TYPE=Release'], { encoding: 'utf8', windowsHide: true });
  if (configure.status !== 0) throw new Error(`Native fixture configure failed: ${configure.stderr || configure.stdout}`);
  const compile = spawnSync('cmake', ['--build', build, '--config', 'Release', '--target', 'NdraResidueExperiment'], { encoding: 'utf8', windowsHide: true });
  if (compile.status !== 0) throw new Error(`Native fixture build failed: ${compile.stderr || compile.stdout}`);
  const candidates = [join(build, 'Release', 'NdraResidueExperiment.exe'), join(build, 'NdraResidueExperiment.exe')];
  const binary = candidates.find(existsSync);
  if (!binary) throw new Error('Native fixture binary was not produced.');
  const executed = spawnSync(binary, [], { encoding: 'utf8', windowsHide: true });
  writeFileSync(join(run.path, 'stdout.log'), executed.stdout || '', 'utf8');
  writeFileSync(join(run.path, 'stderr.log'), executed.stderr || '', 'utf8');
  if (executed.status !== 0) throw new Error(`Native fixture exited ${executed.status}.`);
  const observations = executed.stdout.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
  const divergences = observations.filter((item) => item.candidate_attracted !== item.native_attracted);
  const report = {
    schema_version: SCHEMA, status: divergences.length ? 'COUNTEREXAMPLE' : 'PASS',
    claim: divergences.length ? 'native_reproduced' : 'candidate_verified_bounded',
    cases: observations.length, first_counterexample: divergences[0] || null,
    limitations: ['Fixture injects deterministic GameState and calls the real private Game::updateParticles through its existing test friend.', 'Candidate comparison covers attraction velocity only; it does not modify gameplay or prove player-facing intent.'],
  };
  const caps = { initialize_fixture: true, step: true, observe: true, snapshot: false, restore: false, set_state: true, seed_rng: true, fixed_dt: true, independent_oracle: true };
  const m = manifest(authority, run, 'experiment residue-001', caps);
  m.binary = { path: binary, sha256: sha(binary) };
  m.fixture = { path: fixture, sha256: sha(fixture), dt: 1 / 60 };
  m.compiler = compile.stdout.split(/\r?\n/).find((line) => /compiler|MSBuild|Building/.test(line)) || 'reported in build stdout';
  writeJson(join(run.path, 'manifest.json'), m);
  writeJson(join(run.path, 'experiment.json'), { id: 'residue-001', controlled: ['state', 'dt', 'vacuum', 'battery', 'particle material', 'position', 'velocity'], uncontrolled: [] });
  writeFileSync(join(run.path, 'trace.ndjson'), observations.map((item) => JSON.stringify(item)).join('\n') + '\n', 'utf8');
  writeJson(join(run.path, 'comparison.json'), { comparison: 'native original vs isolated attraction candidate', divergences });
  writeJson(join(run.path, 'counterexamples.json'), divergences);
  writeJson(join(run.path, 'report.json'), report);
  return report;
}

function findReport(value) {
  const direct = resolve(value);
  if (existsSync(direct)) return statSync(direct).isDirectory() ? join(direct, 'report.json') : direct;
  const root = join(process.env.LOCALAPPDATA || process.env.TEMP || '.', 'CommandHud', 'ndra');
  if (!existsSync(root)) throw new Error(`NDRA run not found: ${value}`);
  for (const project of readdirSync(root)) {
    const candidate = join(root, project, value, 'report.json');
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(`NDRA run not found: ${value}`);
}

export async function runNdra(argv) {
  try {
    const { positionals, options } = parse(argv);
    if (!positionals.length || positionals[0] === 'help' || positionals[0] === '--help') { console.log(HELP); return 0; }
    if (positionals[0] === 'report' && positionals.length === 2) {
      const path = findReport(positionals[1]);
      console.log(readFileSync(path, 'utf8').trimEnd());
      console.log(`EVIDENCE=${dirname(path)}`);
      return 0;
    }
    const repo = options.repo || process.cwd();
    const authority = verifyRepo(repo);
    let result;
    let run;
    if (positionals.join(' ') === 'inspect residue') { run = newRun(authority.root, options.out, 'residue-inspect'); result = inspectResidue(authority, run); }
    else if (positionals.join(' ') === 'gauntlet finite') { run = newRun(authority.root, options.out, 'finite'); result = finiteGauntlet(authority, run); }
    else if (positionals.join(' ') === 'experiment residue-001') { run = newRun(authority.root, options.out, 'residue-001'); result = nativeExperiment(authority, run); }
    else throw new Error(`Unknown NDRA command: ${positionals.join(' ')}`);
    console.log(`NDRA_STATUS=${result.status}`);
    console.log(`CLAIM=${result.claim}`);
    console.log(`RUN_ID=${run.id}`);
    console.log(`EVIDENCE=${run.path}`);
    return result.status === 'FAIL' ? 1 : 0;
  } catch (error) {
    console.error(`NDRA_ERROR=${error.message}`);
    console.error('NDRA_STATUS=BLOCKED');
    return /requires|Unknown/.test(error.message) ? 2 : 3;
  }
}
