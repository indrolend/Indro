const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const { mkdtempSync, readdirSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const pty = require('node-pty');

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const cli = resolve(__dirname, '..', '..', 'commandhud', 'cli.mjs');

async function waitFor(predicate, description, output, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await delay(50);
  }
  assert.fail(`${description} timed out; terminal tail: ${output().slice(-900)}`);
}

test('two live PTYs: follower rejects unreadable latest evidence, reports a new run once, and exits on Ctrl-C', { timeout: 30_000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'indro-follow-live-pty-'));
  const state = join(root, '.state');
  const env = { ...process.env, HUD_STATE_ROOT: state };
  const options = { name: 'xterm-256color', cols: 160, rows: 40, cwd: root, env,
    ...(process.platform === 'win32' ? { useConpty: true } : {}) };
  let follower;
  let producer;
  try {
    execFileSync('git', ['init', '-b', 'main'], { cwd: root, stdio: 'pipe' });
    execFileSync('git', ['-c', 'user.name=INDRO', '-c', 'user.email=indro@example.invalid',
      'commit', '--allow-empty', '-m', 'fixture'], { cwd: root, stdio: 'pipe' });
    const run = marker => spawnSync(process.execPath,
      [cli, 'run', '--json', '--', process.execPath, '-e', `console.log('${marker}')`],
      { cwd: root, env, encoding: 'utf8', timeout: 15_000 });
    const older = run('OLDER_VERIFIED_PASS');
    assert.equal(older.status, 0, older.stderr || older.stdout);
    const latest = run('LATEST_UNREADABLE');
    assert.equal(latest.status, 0, latest.stderr || latest.stdout);
    const latestId = JSON.parse(latest.stdout).runId;
    const runsRoot = join(state, 'runs', readdirSync(join(state, 'runs'))[0]);
    writeFileSync(join(runsRoot, latestId, 'run.json'), '{ invalid json');

    let followerOutput = '';
    follower = pty.spawn(process.execPath, [cli, 'output', '--follow'], options);
    const followerExit = new Promise(resolve => follower.onExit(resolve));
    follower.onData(chunk => { followerOutput += chunk; });
    await waitFor(() => followerOutput.includes(`OUTPUT EVIDENCE UNAVAILABLE · run:${latestId}`),
      'unreadable-run rejection', () => followerOutput);
    assert.doesNotMatch(followerOutput, /OLDER_VERIFIED_PASS|LATEST_UNREADABLE/);

    let producerOutput = '';
    producer = pty.spawn(process.execPath,
      [cli, 'run', '--json', '--', process.execPath, '-e', "console.log('PTY_NEW_VERIFIED')"], options);
    const producerExit = new Promise(resolve => producer.onExit(resolve));
    producer.onData(chunk => { producerOutput += chunk; });
    const produced = await Promise.race([producerExit, delay(10000).then(() => null)]);
    assert.ok(produced, `producer did not exit: ${producerOutput.slice(-900)}`);
    assert.equal(produced.exitCode, 0, producerOutput);
    await waitFor(() => followerOutput.includes('PTY_NEW_VERIFIED') &&
      /PASS exit=0 · run:/.test(followerOutput), 'verified follower completion', () => followerOutput);
    await delay(1700); // another full poll must not replay the same completion
    assert.equal((followerOutput.match(/PTY_NEW_VERIFIED/g) || []).length, 1, followerOutput);
    assert.equal((followerOutput.match(/PASS exit=0 · run:/g) || []).length, 1, followerOutput);
    assert.equal((followerOutput.match(/OUTPUT EVIDENCE UNAVAILABLE/g) || []).length, 1, followerOutput);
    assert.doesNotMatch(followerOutput, /OLDER_VERIFIED_PASS|LATEST_UNREADABLE/);

    follower.write('\x03');
    const stopped = await Promise.race([followerExit, delay(5000).then(() => null)]);
    assert.ok(stopped, 'Ctrl-C did not terminate follower PTY');
    assert.equal(stopped.exitCode, 0, `follower exit: ${JSON.stringify(stopped)}`);
  } finally {
    if (producer) { try { producer.kill(); } catch {} }
    if (follower) { try { follower.kill(); } catch {} }
    rmSync(root, { recursive: true, force: true });
  }
});
