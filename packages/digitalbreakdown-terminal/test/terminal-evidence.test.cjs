const test = require("node:test");
const assert = require("node:assert/strict");
const { main, usage } = require("../terminal-evidence.cjs");

test("terminal evidence list is a read-only textual projection", async () => {
  const value = await main(["list", "1"], {
    snapshot: async limit => ({ repository: { name: "demo", branch: "main", head: "abcdef123456" }, operations: [{ runId: "run-1", status: "pass", type: "test", result: "exit 0", evidence: "CURRENT" }], limit })
  });
  assert.match(value, /COMMANDHUD demo/);
  assert.match(value, /run-1 · PASS · test · exit 0 · evidence=CURRENT/);
  assert.match(usage(), /no command execution/i);
});

test("terminal evidence tail never requests raw mode", async () => {
  const calls = [];
  const value = await main(["tail", "run-1", "3"], {
    evidence: async (id, options) => {
      calls.push({ id, options });
      return { runId: id, status: "pass", exitCode: 0, count: 3, streams: [{ stream: "stdout", totalLines: 3, truncated: false, lines: [{ text: "proof" }] }] };
    }
  });
  assert.deepEqual(calls, [{ id: "run-1", options: { mode: "tail", count: 3 } }]);
  assert.match(value, /proof/);
});
