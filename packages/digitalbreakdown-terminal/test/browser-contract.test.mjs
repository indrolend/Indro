import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
const client = await readFile(new URL("../public/client.js", import.meta.url), "utf8");

test("context chrome surrounds rather than replaces xterm", () => {
  assert.match(html, /id="terminal"/);
  assert.match(html, /id="context-location"/);
  assert.match(html, /id="context-repository"/);
  assert.match(html, /id="context-branch"/);
  assert.match(html, /id="context-dirty"/);
  assert.match(html, /id="execution-status"/);
  assert.match(html, /id="exit-status"/);
  assert.match(html, /id="evidence-status"/);
});

test("visuals-off keeps terminal setup and only skips optional visuals", () => {
  assert.match(client, /const visualsEnabled = .*visuals.*off/);
  assert.match(client, /if \(!visualsEnabled\) return/);
  assert.match(client, /new Terminal\(/);
  assert.match(client, /new WebSocket\(/);
  assert.match(client, /terminal\.onData/);
  assert.match(client, /terminal\.parser\.registerOscHandler\(777/);
});

test("jelly is a pointer-transparent public-buffer overlay with an independent toggle", () => {
  assert.match(html, /id="jelly-toggle"/);
  assert.match(html, /#jelly-overlay[\s\S]*pointer-events: none/);
  assert.match(client, /createJellyOverlay/);
  assert.match(client, /jellyOverlay\.setEnabled/);
});

test("terminal uses a true monospace stack and responsive chrome", () => {
  assert.match(client, /Cascadia Mono/);
  assert.doesNotMatch(client, /fontFamily:.*Digital Breakdown Grid V3/);
  assert.match(html, /@media \(max-width: 560px\)/);
  assert.match(html, /text-overflow: ellipsis/);
});

test("INDRO exposes interactive TRACE and read-only SIGNAL displays", () => {
  assert.match(html, /INDRO \/\/ TRACE/);
  assert.match(html, /INDRO \/\/ SIGNAL/);
  assert.match(client, /display=\$\{display\}/);
  assert.match(client, /connectTrace\(id\)/);
  assert.match(client, /connectSignal\(id\)/);
  assert.doesNotMatch(client, /signalSocket\.send/);
});
