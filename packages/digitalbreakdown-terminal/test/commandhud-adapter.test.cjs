const test = require("node:test");
const assert = require("node:assert/strict");
const { existsSync, mkdtempSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");
const { boundedLimit, configuration, createCommandHudReader, evidenceMode, projectKey } = require("../commandhud-adapter.cjs");

test("CommandHUD projection bounds history without changing source authority", () => {
  assert.equal(boundedLimit(undefined), 8);
  assert.equal(boundedLimit(0), 1);
  assert.equal(boundedLimit(99), 25);
  assert.equal(boundedLimit("bad"), 8);
});

test("evidence projection only accepts bounded, non-raw views", () => {
  assert.equal(evidenceMode("head"), "head");
  assert.equal(evidenceMode("tail"), "tail");
  assert.equal(evidenceMode("raw"), "tail");
  assert.equal(evidenceMode("find"), "tail");
});

test("CommandHUD project keys are stable for identity lookup", () => {
  assert.equal(projectKey({ id: "indrolend/data-game" }), "indrolend_data-game");
});

// The terminal must not silently bind to one developer's Windows paths.
test("CommandHUD projection defaults to this INDRO checkout on every platform", () => {
  const actual = configuration({});
  assert.equal(actual.root, resolve(__dirname, "..", "..", ".."));
  assert.equal(actual.core, resolve(__dirname, "..", "..", "commandhud", "core.mjs"));
  assert.ok(existsSync(actual.root));
  assert.ok(existsSync(actual.core));
});

test("explicit project and core overrides remain authoritative", () => {
  const actual = configuration({ DB_COMMANDHUD_ROOT: "./other-project", DB_COMMANDHUD_CORE: "./other-core.mjs" });
  assert.equal(actual.root, resolve("./other-project"));
  assert.equal(actual.core, resolve("./other-core.mjs"));
});

test("invalid evidence identities are rejected before any source access", async () => {
  const reader = createCommandHudReader({ load: async () => { throw new Error("must not load"); } });
  await assert.rejects(reader.evidence("../unscoped"), /Invalid retained evidence identity/);
});

test("explicit non-repository root fails closed instead of falling back", async t => {
  const outside = mkdtempSync(join(tmpdir(), "indro-terminal-unregistered-"));
  t.after(() => rmSync(outside, { recursive: true, force: true }));
  const reader = createCommandHudReader({ env: { DB_COMMANDHUD_ROOT: outside } });
  await assert.rejects(reader.snapshot(1), /No Git repository found/);
});
