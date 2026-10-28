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

test("terminal uses a true monospace stack and responsive chrome", () => {
  assert.match(client, /Cascadia Mono/);
  assert.doesNotMatch(client, /fontFamily:.*Digital Breakdown Grid V3/);
  assert.match(html, /@media \(max-width: 560px\)/);
  assert.match(html, /text-overflow: ellipsis/);
});

test("OSC shell metadata cannot unconditionally overwrite transport execution state", () => {
  assert.match(client, /if \(!decoded \|\| !connected\) return false;/);
  assert.match(client, /executionState = "reported ready";/);
  assert.doesNotMatch(client, /executionState = "ready";\s*renderContext\(\);/);
  assert.match(client, /executionState = "disconnected";/);
});
