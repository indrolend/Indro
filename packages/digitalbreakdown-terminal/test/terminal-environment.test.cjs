const test = require("node:test");
const assert = require("node:assert/strict");
const { terminalEnvironment } = require("../terminal-environment.cjs");

test("ConPTY environment repairs only inherited dumb TERM", () => {
  assert.equal(terminalEnvironment({ TERM: "dumb" }).TERM, "xterm-256color");
  assert.equal(terminalEnvironment({}).TERM, "xterm-256color");
  assert.equal(terminalEnvironment({ TERM: "screen-256color" }).TERM, "screen-256color");
  assert.equal(terminalEnvironment({ TERM: "dumb", DB_TERMINAL_TERM: "vt100" }).TERM, "vt100");
});
