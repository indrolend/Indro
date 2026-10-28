import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const packageRoot = import.meta.dirname;
const repositoryRoot = resolve(packageRoot, '..', '..');
const installer = join(packageRoot, 'runtime', 'Install-MagicFunnel.ps1');
const source = join(packageRoot, 'runtime', 'MagicFunnel.psm1');
const shell = process.platform === 'win32' ? 'pwsh.exe' : 'pwsh';

function runInstaller(args) {
  return spawnSync(shell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', installer, ...args, '-Json'], {
    encoding: 'utf8', timeout: 15_000,
  });
}

test('Magic Funnel installation is reproducible and refuses local runtime drift', () => {
  const root = mkdtempSync(join(tmpdir(), 'indro-magic-funnel-install-'));
  const destination = join(root, 'Modules', 'MagicFunnel', 'MagicFunnel.psm1');
  const profile = join(root, 'Microsoft.PowerShell_profile.ps1');
  const backup = join(root, 'backups');
  const common = ['-Destination', destination, '-ProfilePath', profile, '-BackupRoot', backup];
  try {
    const missing = runInstaller(['-Action', 'Check', ...common]);
    assert.equal(missing.status, 2, missing.stderr || missing.stdout);
    assert.equal(JSON.parse(missing.stdout).status, 'MISSING');

    const installed = runInstaller(['-Action', 'Install', ...common]);
    assert.equal(installed.status, 0, installed.stderr || installed.stdout);
    assert.equal(JSON.parse(installed.stdout).status, 'CURRENT');
    assert.deepEqual(readFileSync(destination), readFileSync(source));
    assert.match(readFileSync(profile, 'utf8'), /Import-Module MagicFunnel -ErrorAction Stop/);

    const current = runInstaller(['-Action', 'Check', ...common]);
    assert.equal(current.status, 0, current.stderr || current.stdout);
    assert.equal(JSON.parse(current.stdout).metadataValid, true);

    appendFileSync(destination, '\n# local customization\n');
    const drifted = runInstaller(['-Action', 'Check', ...common]);
    assert.equal(drifted.status, 2, drifted.stderr || drifted.stdout);
    assert.equal(JSON.parse(drifted.stdout).status, 'LOCALLY_MODIFIED');
    const before = readFileSync(destination);
    const refused = runInstaller(['-Action', 'Install', ...common]);
    assert.notEqual(refused.status, 0);
    assert.deepEqual(readFileSync(destination), before);
    assert.match(refused.stderr, /differs from both source and its last recorded installation/);

    const expected = createHash('sha256').update(before).digest('hex');
    const adopted = runInstaller(['-Action', 'Install', ...common, '-ExpectedInstalledSha256', expected]);
    assert.equal(adopted.status, 0, adopted.stderr || adopted.stdout);
    assert.equal(JSON.parse(adopted.stdout).status, 'CURRENT');
    assert.deepEqual(readFileSync(destination), readFileSync(source));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('versioned Magic Funnel preserves the workstation command interface without a profile', () => {
  const fixture = mkdtempSync(join(tmpdir(), 'indro-magic-funnel-repository-'));
  try {
    execFileSync('git', ['init', '-b', 'main'], { cwd: fixture, stdio: 'pipe' });
    execFileSync('git', ['config', 'user.email', 'funnel@example.invalid'], { cwd: fixture });
    execFileSync('git', ['config', 'user.name', 'Magic Funnel Test'], { cwd: fixture });
    execFileSync('git', ['commit', '--allow-empty', '-m', 'fixture'], { cwd: fixture, stdio: 'pipe' });
    const script = [
      `$env:INDRO_ROOT = '${repositoryRoot.replaceAll("'", "''")}'`,
      `Import-Module '${source.replaceAll("'", "''")}' -Force`,
      `$aliases = 'hud','db','dev','cdb','cdtools','cproj','magic','wdoctor','daily'`,
      `$missing = @($aliases | Where-Object { -not (Get-Alias $_ -ErrorAction SilentlyContinue) })`,
      `if ($missing.Count) { throw ('Missing aliases: ' + ($missing -join ',')) }`,
      `hud --root '${fixture.replaceAll("'", "''")}' state --json`,
    ].join('; ');
    const result = spawnSync(shell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], {
      encoding: 'utf8', timeout: 15_000,
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(JSON.parse(result.stdout).project.root, fixture);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});
