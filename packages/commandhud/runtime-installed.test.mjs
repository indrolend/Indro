import test from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
function command(exe, args, options = {}) {
  const result = spawnSync(exe, args, {
    encoding: 'utf8', windowsHide: true, timeout: 120000,
    shell: process.platform === 'win32', ...options,
  });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, `${exe} ${args.join(' ')}: ${result.stderr || result.stdout}`);
  return result.stdout;
}

test('packed INDRO CLI reports installed, source and stale runtime authority', { timeout: 240000 }, () => {
  const temporary = mkdtempSync(join(tmpdir(), 'indro-runtime-installed-'));
  try {
    const packDir = join(temporary, 'pack');
    const consumer = join(temporary, 'consumer');
    const state = join(temporary, 'state');
    mkdirSync(packDir);
    mkdirSync(consumer);
    mkdirSync(join(state, 'projects'), { recursive: true });
    const pack = JSON.parse(command(npm, ['pack', root, '--pack-destination', packDir, '--json', '--ignore-scripts'], { cwd: temporary }));
    assert.equal(pack.length, 1);
    const archive = join(packDir, pack[0].filename);
    command(npm, ['install', '--prefix', consumer, '--ignore-scripts', '--no-audit', '--no-fund', '--no-package-lock', '--no-save', archive], { cwd: temporary });
    const installed = join(consumer, 'node_modules', '@indrolend', 'indro', 'packages', 'commandhud', 'cli.mjs');
    const source = join(root, 'packages', 'commandhud', 'cli.mjs');
    writeFileSync(join(state, 'projects', 'indro.json'), JSON.stringify({ id: 'indrolend/Indro', root }));
    const env = { ...process.env, HUD_STATE_ROOT: state };
    const observe = (path, expectedCode) => {
      const result = spawnSync(process.execPath, [path, 'runtime', '--json'], {
        cwd: temporary, env, encoding: 'utf8', windowsHide: true, timeout: 30000,
      });
      assert.equal(result.error, undefined, result.error?.message);
      assert.equal(result.status, expectedCode, result.stderr || result.stdout);
      return JSON.parse(result.stdout);
    };
    const observeCanonical = (expectedCode) => {
      const bin = join(consumer, 'node_modules', '.bin', process.platform === 'win32' ? 'indro.cmd' : 'indro');
      const result = spawnSync(bin, ['runtime', '--json'], {
        cwd: temporary, env, encoding: 'utf8', windowsHide: true, timeout: 30000,
        shell: process.platform === 'win32',
      });
      assert.equal(result.error, undefined, result.error?.message);
      assert.equal(result.status, expectedCode, result.stderr || result.stdout);
      return JSON.parse(result.stdout);
    };
    const canonicalCurrent = observeCanonical(0);
    assert.equal(canonicalCurrent.status, 'CURRENT');
    assert.equal(canonicalCurrent.executing.role, 'installed');
    assert.equal(canonicalCurrent.sameBytes, true);
    const current = observe(installed, 0);
    assert.equal(current.status, 'CURRENT');
    assert.equal(current.executing.role, 'installed');
    assert.equal(current.sameBytes, true);
    const direct = observe(source, 0);
    assert.equal(direct.status, 'CURRENT');
    assert.equal(direct.executing.role, 'source');
    appendFileSync(installed, '\n// disposable negative-control mutation\n');
    const stale = observe(installed, 1);
    assert.equal(stale.status, 'STALE');
    assert.equal(stale.executing.role, 'installed');
    assert.equal(stale.sameBytes, false);
    const canonicalStale = observeCanonical(1);
    assert.equal(canonicalStale.status, 'STALE');
    assert.equal(canonicalStale.executing.role, 'installed');
    assert.equal(canonicalStale.sameBytes, false);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});
