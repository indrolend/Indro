import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = join(dirname(fileURLToPath(import.meta.url)), 'repository-map-client');

test('Repository Map client exposes one main menu over one command directory', () => {
  const html = readFileSync(join(directory, 'index.html'), 'utf8');
  const app = readFileSync(join(directory, 'app.js'), 'utf8');
  assert.equal((html.match(/id="toolkitButton"/g) || []).length, 1);
  assert.match(html, /aria-label="Open main HUD menu"/);
  assert.match(html, /aria-label="Main HUD menu"/);
  assert.doesNotMatch(html, /id="(?:categories|undoButton|historyButton|refreshState)"/);
  assert.match(app, /HUD: \[/);
  assert.match(app, /'undo'\]/);
  assert.match(app, /'history'\]/);
  assert.match(app, /'refresh'\]/);
  assert.match(app, /'lint-repository'\]/);
  assert.match(app, /fetch\('\/operations\/lint'/);
  assert.match(app, /stageCommand\('hud lint'\)/);
  assert.match(app, /Commands ·/);
  assert.doesNotMatch(app, /Library ·/);
  assert.match(app, /openMenuSections = new Set\(\['HUD'\]\)/);
  assert.match(app, /dataset\.section/);
  assert.match(app, /new EventSource\('\/events'\)/);
  assert.match(app, /'\/session\/navigation'/);
  assert.match(app, /synchronizeState/);
  assert.doesNotMatch(html, /hud-state\.js/);
  assert.doesNotMatch(app, /tools\/hud/);
  assert.match(app, /hud desktop/);
  assert.match(app, /hud serve/);
});

test('Repository Map client exposes a native terminal-chat composer over authoritative conversation state', () => {
  const html = readFileSync(join(directory, 'index.html'), 'utf8');
  const app = readFileSync(join(directory, 'app.js'), 'utf8');
  assert.match(html, /id="conversation"/);
  assert.match(html, /id="conversationItems" aria-live="polite"/);
  assert.match(html, /<textarea id="commandInput"[^>]+aria-label="Executable command"[^>]+placeholder="Run a command…"/);
  assert.match(html, /id="chatButton"[^>]+>Shell</);
  assert.match(html, /\.app\.chat-open/);
  assert.match(app, /fetch\('\/conversation\?limit=20'/);
  assert.match(app, /content\.command/);
  assert.match(app, /capabilities\?\.canViewRaw/);
  assert.match(app, /capabilities\?\.canCancel/);
  assert.match(app, /outputAction\('Stop'/);
  assert.match(app, /outputAction\('Details'/);
  assert.match(app, /chatButton\.textContent = open \? 'Files' : 'Shell'/);
  assert.match(app, /terminalEnabled && !terminalWasReady/);
  assert.match(app, /textContent = 'CommandHUD'/);
  assert.match(app, /showEvidence\(item\.runId, 'stdout'\)/);
  assert.match(app, /window\.innerWidth <= 640/);
  assert.match(app, /input\.blur\(\)/);
  assert.match(app, /requestSubmit\(\)/);
  assert.doesNotMatch(app, /xterm/i);
});
