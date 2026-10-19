const test = require("node:test");
const assert = require("node:assert/strict");
const { boundedLimit, evidenceMode, projectKey } = require("../commandhud-adapter.cjs");

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
