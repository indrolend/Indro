import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const cli = join(import.meta.dirname, 'cli.mjs');

for (const command of ['help', '--help', '-h']) {
  test(`hud ${command} is available outside a repository`, () => {
    const outside = mkdtempSync(join(tmpdir(), 'commandhud-help-'));
    try {
      const result = spawnSync(process.execPath, [cli, command], {
        cwd: outside, encoding: 'utf8', timeout: 10_000,
      });
      assert.equal(result.status, 0, result.stderr || result.stdout);
      assert.match(result.stdout, /Indro · CommandHUD execution and evidence/);
      assert.match(result.stdout, /hud shell/);
      assert.match(result.stdout, /Retained evidence \(never reruns the command\)/);
      assert.match(result.stdout, /hud undo-plan <run>/);
      assert.doesNotMatch(result.stderr, /No Git repository/);
      assert.ok(result.stdout.trimEnd().split(/\r?\n/).length < 40);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
}

test('client routes reject unknown, missing, irrelevant, and positional arguments', () => {
  const root = mkdtempSync(join(tmpdir(), 'commandhud-client-route-'));
  try {
    execFileSync('git', ['init', '-b', 'main'], { cwd: root, stdio: 'pipe' });
    execFileSync('git', ['config', 'user.email', 'hud@example.invalid'], { cwd: root });
    execFileSync('git', ['config', 'user.name', 'HUD Test'], { cwd: root });
    execFileSync('git', ['commit', '--allow-empty', '-m', 'fixture'], { cwd: root, stdio: 'pipe' });
    const run = (args) => spawnSync(process.execPath, [cli, ...args], {
      cwd: root, encoding: 'utf8', timeout: 10_000,
    });
    const unknown = run(['state', '--definitely-unknown']);
    assert.notEqual(unknown.status, 0);
    assert.match(unknown.stderr, /Unknown hud option: --definitely-unknown/);

    const missing = run(['state', '--root']);
    assert.notEqual(missing.status, 0);
    assert.match(missing.stderr, /--root requires a value/);

    const irrelevant = run(['desktop', '--tui']);
    assert.notEqual(irrelevant.status, 0);
    assert.match(irrelevant.stderr, /hud desktop does not support --tui/);

    const positional = run(['shell', 'desktop']);
    assert.notEqual(positional.status, 0);
    assert.match(positional.stderr, /hud shell accepts at most 0 positional arguments/);

    const ignoredPositional = run(['state', 'unexpected']);
    assert.notEqual(ignoredPositional.status, 0);
    assert.match(ignoredPositional.stderr, /hud state accepts at most 0 positional arguments/);

    const runOption = run(['run', '--json', '--bad']);
    assert.notEqual(runOption.status, 0);
    assert.match(runOption.stderr, /Unknown hud option: --bad/);

    const orphanedWorkflow = run(['run', '--stage', 'test', '--', process.execPath, '-e', '']);
    assert.notEqual(orphanedWorkflow.status, 0);
    assert.match(orphanedWorkflow.stderr, /workflow details require --workflow-id/);

    const conflictingRequest = run(['run', '--request', 'text', '--request-b64', 'dGV4dA==', '--', process.execPath, '-e', '']);
    assert.notEqual(conflictingRequest.status, 0);
    assert.match(conflictingRequest.stderr, /either --request or --request-b64/);

    const ignoredCopy = run(['handoff', '--copy', '--json']);
    assert.notEqual(ignoredCopy.status, 0);
    assert.match(ignoredCopy.stderr, /does not combine --copy with --json/);

    const wrongLayer = run(['state', '--host', '127.0.0.1']);
    assert.notEqual(wrongLayer.status, 0);
    assert.match(wrongLayer.stderr, /hud state does not support --host/);

    const selectedRoot = run(['state', '--json', '--root', root]);
    assert.equal(selectedRoot.status, 0, selectedRoot.stderr || selectedRoot.stdout);
    assert.equal(realpathSync.native(JSON.parse(selectedRoot.stdout).project.root), realpathSync.native(root));

    const clear = run(['objective', '--clear', '--root', root]);
    assert.equal(clear.status, 0, clear.stderr || clear.stdout);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('hud doctor returns a tiny bounded summary and retained evidence', () => {
  const root = mkdtempSync(join(tmpdir(), 'commandhud-doctor-'));
  try {
    execFileSync('git', ['init', '-b', 'main'], { cwd: root, stdio: 'pipe' });
    execFileSync('git', ['config', 'user.email', 'hud@example.invalid'], { cwd: root });
    execFileSync('git', ['config', 'user.name', 'HUD Test'], { cwd: root });
    execFileSync('git', ['commit', '--allow-empty', '-m', 'fixture'], { cwd: root, stdio: 'pipe' });
    const state = mkdtempSync(join(tmpdir(), 'commandhud-doctor-state-'));
    const result = spawnSync(process.execPath, [cli, 'doctor', '--root', root], {
      cwd: root, encoding: 'utf8', timeout: 15_000, env: { ...process.env, HUD_STATE_ROOT: state },
    });
    const search = spawnSync('rg', ['--version'], { cwd: root, encoding: 'utf8', timeout: 2000 });
    const searchAvailable = search.status === 0 && /^ripgrep /m.test(search.stdout || '');
    assert.equal(result.status, searchAvailable ? 0 : 1, result.stderr || result.stdout);
    assert.match(result.stdout, searchAvailable ? /^DOCTOR PASS 4\/4/m : /^DOCTOR FAIL 3\/4/m);
    if (!searchAvailable) assert.match(result.stdout, /^search BLOCKED run:/m);
    assert.match(result.stdout, /^EVIDENCE /m);
    assert.ok(result.stdout.trimEnd().split(/\r?\n/).length <= 3);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('hud run JSON is pure for passing and failing commands', () => {
  const root = mkdtempSync(join(tmpdir(), 'commandhud-json-route-'));
  try {
    execFileSync('git', ['init', '-b', 'main'], { cwd: root, stdio: 'pipe' });
    execFileSync('git', ['config', 'user.email', 'hud@example.invalid'], { cwd: root });
    execFileSync('git', ['config', 'user.name', 'HUD Test'], { cwd: root });
    execFileSync('git', ['commit', '--allow-empty', '-m', 'fixture'], { cwd: root, stdio: 'pipe' });
    const run = (script) => spawnSync(process.execPath, [cli, 'run', '--json', '--', process.execPath, '-e', script], {
      cwd: root, encoding: 'utf8', timeout: 10_000,
      env: { ...process.env, HUD_STATE_ROOT: join(root, '.state') },
    });
    const passing = spawnSync(process.execPath, [cli, 'run', '--json', '--workflow-id', 'verify', '--workflow-name', 'verify JSON', '--stage', 'test', '--stage-index', '1', '--stage-count', '1', '--', process.execPath, '-e', "console.log('not-before-json')"], {
      cwd: root, encoding: 'utf8', timeout: 10_000,
      env: { ...process.env, HUD_STATE_ROOT: join(root, '.state') },
    });
    assert.equal(passing.status, 0, passing.stderr);
    assert.equal(JSON.parse(passing.stdout).status, 'pass');
    assert.doesNotMatch(passing.stdout, /^not-before-json/m);

    const failing = run("console.error('not-before-json'); process.exit(7)");
    assert.equal(failing.status, 1, failing.stderr);
    assert.equal(JSON.parse(failing.stdout).status, 'fail');
    assert.doesNotMatch(failing.stdout, /^not-before-json/m);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('hud run preserves argv metacharacters instead of invoking a command shell', () => {
  const root = mkdtempSync(join(tmpdir(), 'commandhud-argv-'));
  try {
    execFileSync('git', ['init', '-b', 'main'], { cwd: root, stdio: 'pipe' });
    execFileSync('git', ['config', 'user.email', 'hud@example.invalid'], { cwd: root });
    execFileSync('git', ['config', 'user.name', 'HUD Test'], { cwd: root });
    execFileSync('git', ['commit', '--allow-empty', '-m', 'fixture'], { cwd: root, stdio: 'pipe' });
    const result = spawnSync(process.execPath, [cli, 'run', '--root', root, '--quiet', '--json', '--', process.execPath, '-e', 'console.log(process.argv[1])', 'left|right'], {
      cwd: root, encoding: 'utf8', timeout: 10_000,
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const value = JSON.parse(result.stdout);
    assert.equal(readFileSync(value.stdoutPath, 'utf8').trim(), 'left|right');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('hud run argv operation is immediately handoff-capable', () => {
  const root = mkdtempSync(join(tmpdir(), 'commandhud-run-handoff-'));
  const state = join(root, '.state');
  try {
    execFileSync('git', ['init', '-b', 'main'], { cwd: root, stdio: 'pipe' });
    execFileSync('git', ['config', 'user.email', 'hud@example.invalid'], { cwd: root });
    execFileSync('git', ['config', 'user.name', 'HUD Test'], { cwd: root });
    execFileSync('git', ['commit', '--allow-empty', '-m', 'fixture'], { cwd: root, stdio: 'pipe' });
    const env = { ...process.env, HUD_STATE_ROOT: state };
    const argvValue = 'left|right&still-data';
    const passing = spawnSync(process.execPath, [cli, 'run', '--json', '--', process.execPath, '-e', 'console.log(process.argv[1])', argvValue], {
      cwd: root, encoding: 'utf8', timeout: 10_000, env,
    });
    assert.equal(passing.status, 0, passing.stderr || passing.stdout);
    const run = JSON.parse(passing.stdout);
    assert.equal(run.operation.type, 'argv-command');
    assert.deepEqual(run.operation.argv, [process.execPath, '-e', 'console.log(process.argv[1])', argvValue]);
    assert.equal(run.operation.status, 'pass');
    assert.equal(readFileSync(run.stdoutPath, 'utf8').trim(), argvValue);

    const handoffResult = spawnSync(process.execPath, [cli, 'handoff', '--json'], {
      cwd: root, encoding: 'utf8', timeout: 10_000, env,
    });
    assert.equal(handoffResult.status, 0, handoffResult.stderr || handoffResult.stdout);
    const handoff = JSON.parse(handoffResult.stdout);
    assert.equal(handoff.runId, run.runId);
    assert.match(handoff.handoff, /OPERATION ARGV-COMMAND/);
    assert.match(handoff.handoff, /ARGV /);
    assert.match(handoff.handoff, /left\|right&still-data/);

    const failing = spawnSync(process.execPath, [cli, 'run', '--json', '--', process.execPath, '-e', 'process.exit(7)', argvValue], {
      cwd: root, encoding: 'utf8', timeout: 10_000, env,
    });
    assert.equal(failing.status, 1, failing.stderr || failing.stdout);
    const failedRun = JSON.parse(failing.stdout);
    assert.equal(failedRun.operation.type, 'argv-command');
    assert.deepEqual(failedRun.operation.argv, [process.execPath, '-e', 'process.exit(7)', argvValue]);
    assert.equal(failedRun.operation.exitCode, 7);
    assert.equal(failedRun.operation.status, 'fail');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('hud search reports a missing rg capability without attempting execution', () => {
  const root = mkdtempSync(join(tmpdir(), 'commandhud-search-capability-'));
  try {
    execFileSync('git', ['init', '-b', 'main'], { cwd: root, stdio: 'pipe' });
    execFileSync('git', ['config', 'user.email', 'hud@example.invalid'], { cwd: root });
    execFileSync('git', ['config', 'user.name', 'HUD Test'], { cwd: root });
    writeFileSync(join(root, 'content.txt'), 'needle\n');
    execFileSync('git', ['add', '.'], { cwd: root });
    execFileSync('git', ['commit', '-m', 'fixture'], { cwd: root, stdio: 'pipe' });
    const locator = spawnSync(process.platform === 'win32' ? 'where.exe' : 'which', ['git'], { encoding: 'utf8' });
    assert.equal(locator.status, 0, locator.stderr);
    const gitDirectory = dirname(locator.stdout.split(/\r?\n/).find(Boolean));
    const result = spawnSync(process.execPath, [cli, 'search', '--json', 'needle'], {
      cwd: root, encoding: 'utf8', timeout: 10_000,
      env: { ...process.env, PATH: gitDirectory, HUD_STATE_ROOT: join(root, '.state') },
    });
    assert.equal(result.status, 2, result.stderr || result.stdout);
    const value = JSON.parse(result.stdout);
    assert.equal(value.status, 'blocked');
    assert.equal(value.operation.requiredCapability, 'rg');
    assert.equal(value.operation.capability.state, 'missing');
    assert.equal(value.operation.executionAttempted, false);
    assert.match(readFileSync(value.stderrPath, 'utf8'), /was not executed/i);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('hud runtime uses scriptable exit status for current and stale source authority', () => {
  const temporary = mkdtempSync(join(tmpdir(), 'commandhud-runtime-cli-'));
  const state = join(temporary, 'state');
  const source = join(temporary, 'source');
  const sourceCli = join(source, 'packages', 'commandhud', 'cli.mjs');
  mkdirSync(join(state, 'projects'), { recursive: true });
  mkdirSync(join(source, 'packages', 'commandhud'), { recursive: true });
  copyFileSync(cli, sourceCli);
  writeFileSync(join(state, 'projects', 'product.json'), JSON.stringify({
    id: 'indrolend/Indro', root: source,
  }));
  const run = () => spawnSync(process.execPath, [cli, 'runtime', '--json'], {
    cwd: temporary, encoding: 'utf8', timeout: 10_000,
    env: { ...process.env, HUD_STATE_ROOT: state },
  });
  try {
    const current = run();
    assert.equal(current.status, 0, current.stderr || current.stdout);
    assert.equal(JSON.parse(current.stdout).status, 'CURRENT');
    writeFileSync(sourceCli, 'stale source bytes');
    const stale = run();
    assert.equal(stale.status, 1, stale.stderr || stale.stdout);
    assert.equal(JSON.parse(stale.stdout).status, 'STALE');
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

test('hud impact human and JSON views inspect one retained record without creating a run', () => {
  const temporary = mkdtempSync(join(tmpdir(), 'commandhud-impact-cli-'));
  const state = join(temporary, 'state');
  const root = join(temporary, 'repo');
  mkdirSync(join(root, 'distribution'), { recursive: true });
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'src', 'file.txt'), 'initial\n');
  writeFileSync(join(root, 'distribution', 'project.json'), JSON.stringify({
    id: 'fixture/impact-cli', commandHud: { commands: [{
      name: 'verify', command: 'node verify', argv: [process.execPath, '-e', "console.log('VERIFY_STAGE=PASS name=source'); console.log('VERIFY=PASS')"],
      resultMarkers: true, stageMarker: 'VERIFY_STAGE', stages: [{ name: 'source', paths: ['src'] }],
    }] },
  }));
  execFileSync('git', ['init', '-b', 'main'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'hud@example.invalid'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'HUD Test'], { cwd: root });
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['commit', '-m', 'fixture'], { cwd: root });
  const run = (args) => spawnSync(process.execPath, [cli, ...args, '--root', root], {
    cwd: root, encoding: 'utf8', timeout: 20_000, env: { ...process.env, HUD_STATE_ROOT: state },
  });
  try {
    const recorded = run(['repository-command', 'verify', '--json', '--quiet']);
    assert.equal(recorded.status, 0, recorded.stderr || recorded.stdout);
    const runId = JSON.parse(recorded.stdout).runId;
    const runsRoot = join(state, 'runs', 'fixture_impact-cli');
    const countBefore = readdirSync(runsRoot).length;
    const json = run(['impact', 'verify', '--json']);
    const human = run(['impact', 'verify']);
    assert.equal(json.status, 0, json.stderr || json.stdout);
    assert.equal(human.status, 0, human.stderr || human.stdout);
    const value = JSON.parse(json.stdout);
    assert.equal(value.runId, runId);
    assert.equal(value.state, 'CURRENT');
    assert.equal(value.stages[0].state, 'CURRENT');
    assert.match(human.stdout, new RegExp(`IMPACT verify[\\s\\S]*RUN ${runId}[\\s\\S]*source PASS CURRENT[\\s\\S]*RAW run:${runId}`));
    assert.equal(readdirSync(runsRoot).length, countBefore);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

test('hud storage human and JSON views inspect all retained projects without creating a run', () => {
  const temporary = mkdtempSync(join(tmpdir(), 'commandhud-storage-cli-'));
  const state = join(temporary, 'state');
  const root = join(temporary, 'repo');
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, 'file.txt'), 'fixture\n');
  execFileSync('git', ['init', '-b', 'main'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'hud@example.invalid'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'HUD Test'], { cwd: root });
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['commit', '-m', 'fixture'], { cwd: root });
  const run = (args) => spawnSync(process.execPath, [cli, ...args, '--root', root], {
    cwd: root, encoding: 'utf8', timeout: 20_000, env: { ...process.env, HUD_STATE_ROOT: state },
  });
  try {
    const recorded = spawnSync(process.execPath, [cli, 'run', '--json', '--quiet', '--root', root, '--', process.execPath, '-e', 'console.log("stored")'], {
      cwd: root, encoding: 'utf8', timeout: 20_000, env: { ...process.env, HUD_STATE_ROOT: state },
    });
    assert.equal(recorded.status, 0, recorded.stderr || recorded.stdout);
    assert.equal(JSON.parse(recorded.stdout).status, 'pass');
    const runsRoot = join(state, 'runs');
    const countRuns = () => readdirSync(runsRoot, { recursive: true, withFileTypes: true }).filter((entry) => entry.isFile() && entry.name === 'run.json').length;
    const countBefore = countRuns();
    const json = run(['storage', '--json']);
    const human = run(['storage']);
    assert.equal(json.status, 0, json.stderr || json.stdout);
    assert.equal(human.status, 0, human.stderr || human.stdout);
    const value = JSON.parse(json.stdout);
    assert.equal(value.runCount, 1);
    assert.equal(value.integrity.VERIFIED, 1);
    assert.match(human.stdout, /COMMANDHUD_STORAGE[\s\S]*runs=1[\s\S]*INTEGRITY VERIFIED=1/);
    assert.equal(countRuns(), countBefore);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});


test('hud output shows outputless latest run and escapes terminal control bytes', () => {
  const root = mkdtempSync(join(tmpdir(), 'commandhud-output-main-'));
  try {
    execFileSync('git', ['init', '-b', 'main'], { cwd: root, stdio: 'pipe' });
    execFileSync('git', ['config', 'user.email', 'hud@example.invalid'], { cwd: root });
    execFileSync('git', ['config', 'user.name', 'HUD Test'], { cwd: root });
    execFileSync('git', ['commit', '--allow-empty', '-m', 'fixture'], { cwd: root, stdio: 'pipe' });
    const env = { ...process.env, HUD_STATE_ROOT: join(root, '.state') };
    const run = (script) => spawnSync(process.execPath, [cli, 'run', '--json', '--', process.execPath, '-e', script], {
      cwd: root, env, encoding: 'utf8', timeout: 20_000,
    });
    assert.equal(run("console.log('older-output')").status, 0);
    assert.equal(run('').status, 0);
    const empty = spawnSync(process.execPath, [cli, 'output'], { cwd: root, env, encoding: 'utf8', timeout: 10_000 });
    assert.equal(empty.status, 0, empty.stderr || empty.stdout);
    assert.match(empty.stdout, /\(no output\)/);
    assert.doesNotMatch(empty.stdout, /older-output/);
    assert.equal(run("process.stdout.write('\\x1b[31mred\\x07\\n')").status, 0);
    const controlled = spawnSync(process.execPath, [cli, 'output'], { cwd: root, env, encoding: 'utf8', timeout: 10_000 });
    assert.equal(controlled.status, 0, controlled.stderr || controlled.stdout);
    assert.match(controlled.stdout, /␛\[31mred\\x07/);
    assert.doesNotMatch(controlled.stdout, /\x1b/);
    assert.match(controlled.stdout, /legacy stream order/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('hud output --follow reports independent completed runs exactly once', async () => {
  const root = mkdtempSync(join(tmpdir(), 'commandhud-output-follow-main-'));
  let follower;
  try {
    execFileSync('git', ['init', '-b', 'main'], { cwd: root, stdio: 'pipe' });
    execFileSync('git', ['config', 'user.email', 'hud@example.invalid'], { cwd: root });
    execFileSync('git', ['config', 'user.name', 'HUD Test'], { cwd: root });
    execFileSync('git', ['commit', '--allow-empty', '-m', 'fixture'], { cwd: root, stdio: 'pipe' });
    const env = { ...process.env, HUD_STATE_ROOT: join(root, '.state') };
    follower = spawn(process.execPath, [cli, 'output', '--follow'], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    follower.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    follower.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    await new Promise((resolve) => setTimeout(resolve, 300));
    const execute = (script) => spawnSync(process.execPath, [cli, 'run', '--json', '--', process.execPath, '-e', script], {
      cwd: root, env, encoding: 'utf8', timeout: 20_000,
    });
    assert.equal(execute("console.log('follow-one')").status, 0);
    assert.equal(execute('').status, 0);
    assert.equal(execute("console.log('follow-three')").status, 0);
    const deadline = Date.now() + 12_000;
    while ((stdout.match(/— PASS exit=0 · run:/g) || []).length < 3 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.equal(stderr, '');
    assert.match(stdout, /follow-one/);
    assert.match(stdout, /\(no output\)/);
    assert.match(stdout, /follow-three/);
    assert.equal((stdout.match(/— PASS exit=0 · run:/g) || []).length, 3, stdout);
    assert.ok(stdout.indexOf('follow-one') < stdout.indexOf('follow-three'));
  } finally {
    if (follower && follower.exitCode === null) {
      await new Promise((resolve) => {
        follower.once('exit', resolve);
        follower.kill('SIGTERM');
        setTimeout(() => { follower.kill('SIGKILL'); resolve(); }, 1500).unref();
      });
    }
    rmSync(root, { recursive: true, force: true });
  }
});


test('hud output --follow covers 101 completions after running-only history without false gap', async () => {
  const root = mkdtempSync(join(tmpdir(), 'commandhud-output-window-'));
  let follower;
  try {
    execFileSync('git', ['init', '-b', 'main'], { cwd: root, stdio: 'pipe' });
    execFileSync('git', ['config', 'user.email', 'hud@example.invalid'], { cwd: root });
    execFileSync('git', ['config', 'user.name', 'HUD Test'], { cwd: root });
    execFileSync('git', ['commit', '--allow-empty', '-m', 'fixture'], { cwd: root, stdio: 'pipe' });
    const state = join(root, '.state');
    const env = { ...process.env, HUD_STATE_ROOT: state };
    const seed = spawnSync(process.execPath, [cli, 'run', '--json', '--', process.execPath, '-e', "console.log('seed')"], {
      cwd: root, env, encoding: 'utf8', timeout: 20_000,
    });
    assert.equal(seed.status, 0, seed.stderr || seed.stdout);
    const runRoot = join(state, 'runs', readdirSync(join(state, 'runs'))[0]);
    const seedRecord = JSON.parse(readFileSync(join(runRoot, JSON.parse(seed.stdout).runId, 'run.json'), 'utf8'));
    const makeRecord = (i, status) => {
      const id = '20990101000000-' + i.toString(16).padStart(4, '0');
      const directory = join(runRoot, id);
      mkdirSync(directory, { recursive: true });
      const stdoutPath = join(directory, 'stdout.log');
      const stderrPath = join(directory, 'stderr.log');
      const output = 'window-marker-' + i + '\n';
      writeFileSync(stdoutPath, output);
      writeFileSync(stderrPath, '');
      const record = { ...seedRecord, id, status, exitCode: status === 'running' ? null : 0,
        stdoutPath, stderrPath, startedAt: new Date(Date.UTC(2099, 0, 1, 0, 0, 0, i)).toISOString(),
        endedAt: status === 'running' ? null : new Date(Date.UTC(2099, 0, 1, 0, 0, 0, i)).toISOString(),
        evidence: { ...seedRecord.evidence, stdout: {
          bytes: Buffer.byteLength(output), sha256: `sha256:${createHash('sha256').update(output).digest('hex')}`,
        } } };
      writeFileSync(join(directory, 'run.json'), JSON.stringify(record));
      return record;
    };
    for (let i = 0; i < 100; i++) makeRecord(i, 'running');
    follower = spawn(process.execPath, [cli, 'output', '--follow'], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    follower.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    follower.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    await new Promise((resolve) => setTimeout(resolve, 1800));
    assert.doesNotMatch(stdout, /OUTPUT GAP|OUTPUT COVERAGE UNCERTAIN/);
    for (let i = 0; i < 100; i++) makeRecord(i, 'pass');
    makeRecord(100, 'pass');
    const deadline = Date.now() + 15_000;
    const completions = () => (stdout.match(/— PASS exit=0 · run:20990101000000-/g) || []).length;
    while (completions() < 101 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.equal(stderr, '');
    assert.equal(completions(), 101, stdout.slice(-2000));
    assert.match(stdout, /window-marker-0\n/);
    assert.match(stdout, /window-marker-100\n/);
    assert.ok(stdout.indexOf('window-marker-0\n') < stdout.indexOf('window-marker-100\n'));
    assert.doesNotMatch(stdout, /OUTPUT GAP|OUTPUT COVERAGE UNCERTAIN/);
  } finally {
    if (follower && follower.exitCode === null) {
      await new Promise((resolve) => {
        follower.once('exit', resolve);
        follower.kill('SIGTERM');
        setTimeout(() => { follower.kill('SIGKILL'); resolve(); }, 1500).unref();
      });
    }
    rmSync(root, { recursive: true, force: true });
  }
});


test('hud output --follow isolates missing retained evidence and displays later completion', async () => {
  const root = mkdtempSync(join(tmpdir(), 'commandhud-output-missing-evidence-'));
  let follower;
  try {
    execFileSync('git', ['init', '-b', 'main'], { cwd: root, stdio: 'pipe' });
    execFileSync('git', ['config', 'user.email', 'hud@example.invalid'], { cwd: root });
    execFileSync('git', ['config', 'user.name', 'HUD Test'], { cwd: root });
    execFileSync('git', ['commit', '--allow-empty', '-m', 'fixture'], { cwd: root, stdio: 'pipe' });
    const state = join(root, '.state');
    const env = { ...process.env, HUD_STATE_ROOT: state };
    const execute = (script) => spawnSync(process.execPath, [cli, 'run', '--json', '--', process.execPath, '-e', script], {
      cwd: root, env, encoding: 'utf8', timeout: 20_000,
    });
    const seed = execute("console.log('follower-seed')");
    assert.equal(seed.status, 0, seed.stderr || seed.stdout);
    follower = spawn(process.execPath, [cli, 'output', '--follow'], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    follower.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    follower.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    await new Promise((resolve) => setTimeout(resolve, 350));
    const damaged = execute("console.log('should-not-be-presented-as-verified')");
    assert.equal(damaged.status, 0, damaged.stderr || damaged.stdout);
    const runRoot = join(state, 'runs', readdirSync(join(state, 'runs'))[0]);
    const damagedId = JSON.parse(damaged.stdout).runId;
    const record = JSON.parse(readFileSync(join(runRoot, damagedId, 'run.json'), 'utf8'));
    unlinkSync(record.stdoutPath);
    const healthy = execute("console.log('healthy-after-broken')");
    assert.equal(healthy.status, 0, healthy.stderr || healthy.stdout);
    const deadline = Date.now() + 8_000;
    while (!stdout.includes('healthy-after-broken') && follower.exitCode === null && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.match(stdout, new RegExp('OUTPUT EVIDENCE UNAVAILABLE[^\\n]*' + damagedId));
    assert.match(stdout, /healthy-after-broken/);
    assert.doesNotMatch(stdout, /should-not-be-presented-as-verified/);
    assert.equal(stderr, '');
    assert.equal(follower.exitCode, null);
  } finally {
    if (follower && follower.exitCode === null) {
      await new Promise((resolve) => {
        follower.once('exit', resolve);
        follower.kill('SIGTERM');
        setTimeout(() => { follower.kill('SIGKILL'); resolve(); }, 1500).unref();
      });
    }
    rmSync(root, { recursive: true, force: true });
  }
});


test('hud output rejects modified retained stdout instead of presenting forged PASS', () => {
  const root = mkdtempSync(join(tmpdir(), 'commandhud-output-integrity-'));
  try {
    execFileSync('git', ['init', '-b', 'main'], { cwd: root, stdio: 'pipe' });
    execFileSync('git', ['config', 'user.email', 'hud@example.invalid'], { cwd: root });
    execFileSync('git', ['config', 'user.name', 'HUD Test'], { cwd: root });
    execFileSync('git', ['commit', '--allow-empty', '-m', 'fixture'], { cwd: root, stdio: 'pipe' });
    const state = join(root, '.state');
    const env = { ...process.env, HUD_STATE_ROOT: state };
    const run = spawnSync(process.execPath, [cli, 'run', '--json', '--', process.execPath, '-e', "console.log('original-evidence')"], {
      cwd: root, env, encoding: 'utf8', timeout: 20_000,
    });
    assert.equal(run.status, 0, run.stderr || run.stdout);
    const runId = JSON.parse(run.stdout).runId;
    const runRoot = join(state, 'runs', readdirSync(join(state, 'runs'))[0]);
    const record = JSON.parse(readFileSync(join(runRoot, runId, 'run.json'), 'utf8'));
    const output = () => spawnSync(process.execPath, [cli, 'output'], { cwd: root, env, encoding: 'utf8', timeout: 10_000 });
    const valid = output();
    assert.equal(valid.status, 0, valid.stderr || valid.stdout);
    assert.match(valid.stdout, /original-evidence/);
    writeFileSync(record.stdoutPath, 'forged-evidence\n');
    const corrupt = output();
    assert.equal(corrupt.status, 0, corrupt.stderr || corrupt.stdout);
    assert.match(corrupt.stdout, new RegExp('OUTPUT EVIDENCE UNAVAILABLE[^\\n]*' + runId));
    assert.doesNotMatch(corrupt.stdout, /forged-evidence/);
    assert.doesNotMatch(corrupt.stdout, /— PASS exit=0/);
    writeFileSync(record.stdoutPath, 'original-evidence\n');
    const restored = output();
    assert.equal(restored.status, 0, restored.stderr || restored.stdout);
    assert.match(restored.stdout, /original-evidence/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
