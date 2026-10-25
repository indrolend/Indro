const test = require("node:test");
const assert = require("node:assert/strict");
const { createSessionManager } = require("../session-manager.cjs");

function fixture(options = {}) {
  const ptys = [];
  const manager = createSessionManager({
    setIntervalFn: () => ({ unref() {} }),
    clearIntervalFn() {},
    spawnPty() {
      const dataHandlers = new Set();
      const exitHandlers = new Set();
      const instance = {
        writes: [], resizes: [], killed: 0,
        write(value) { this.writes.push(value); },
        resize(cols, rows) { this.resizes.push([cols, rows]); },
        kill() { this.killed += 1; },
        onData(handler) { dataHandlers.add(handler); return { dispose: () => dataHandlers.delete(handler) }; },
        onExit(handler) { exitHandlers.add(handler); return { dispose: () => exitHandlers.delete(handler) }; },
        output(value) { for (const handler of dataHandlers) handler(value); },
        exit(exitCode) { for (const handler of exitHandlers) handler({ exitCode }); }
      };
      ptys.push(instance);
      return instance;
    },
    ...options
  });
  return { manager, ptys };
}

function client({ fail = false, bufferedAmount = 0 } = {}) {
  return {
    readyState: 1, bufferedAmount, sent: [], closes: [],
    send(value) { if (fail) throw new Error("send failed"); this.sent.push(JSON.parse(value)); },
    close(code, reason) { this.closes.push([code, reason]); this.readyState = 3; }
  };
}

test("one session owns one PTY while TRACE and SIGNAL subscribe", () => {
  const { manager, ptys } = fixture();
  const trace = manager.attach({ sessionId: "shared", display: "trace", socket: client() });
  manager.attach({ sessionId: "shared", display: "signal", socket: client() });
  assert.equal(ptys.length, 1);
  trace.receive(JSON.stringify({ type: "input", data: "echo once\r" }));
  assert.deepEqual(ptys[0].writes, ["echo once\r"]);
  manager.close();
});

test("SIGNAL is read-only, including explicit shutdown", () => {
  const { manager, ptys } = fixture();
  const signal = manager.attach({ sessionId: "readonly", display: "signal", socket: client() });
  signal.receive(JSON.stringify({ type: "input", data: "forbidden" }));
  signal.receive(JSON.stringify({ type: "resize", cols: 80, rows: 24 }));
  signal.receive(JSON.stringify({ type: "shutdown" }));
  assert.deepEqual(ptys[0].writes, []);
  assert.deepEqual(ptys[0].resizes, []);
  assert.equal(manager.sessionCount(), 1);
  manager.close();
});

test("disconnect preserves a running PTY and reconnect receives a snapshot", () => {
  const { manager, ptys } = fixture();
  const firstSocket = client();
  const first = manager.attach({ sessionId: "resume", display: "trace", socket: firstSocket });
  first.receive(JSON.stringify({ type: "input", data: "long-command\r" }));
  ptys[0].output("partial output");
  first.detach();
  assert.equal(ptys[0].killed, 0);
  const resumedSocket = client();
  manager.attach({ sessionId: "resume", display: "trace", socket: resumedSocket });
  assert.equal(ptys.length, 1);
  assert.equal(resumedSocket.sent[0].type, "session.snapshot");
  assert.equal(resumedSocket.sent[0].output, "partial output");
  assert.equal(resumedSocket.sent[0].state.execution, "running");
  manager.close();
});

test("idle sessions are cleaned up after the bound and TRACE can explicitly shut down", () => {
  let time = 100;
  const { manager, ptys } = fixture({ now: () => time, idleTimeoutMs: 50 });
  const attached = manager.attach({ sessionId: "idle", display: "trace", socket: client() });
  attached.detach();
  time = 149; manager.sweep();
  assert.equal(manager.sessionCount(), 1);
  time = 150; manager.sweep();
  assert.equal(manager.sessionCount(), 0);
  assert.equal(ptys[0].killed, 1);
  const explicit = manager.attach({ sessionId: "explicit", display: "trace", socket: client() });
  explicit.receive(JSON.stringify({ type: "shutdown" }));
  assert.equal(manager.sessionCount(), 0);
  manager.close();
});

test("snapshots precede strictly ordered live events", () => {
  const { manager, ptys } = fixture();
  const socket = client();
  manager.attach({ sessionId: "ordered", display: "trace", socket });
  ptys[0].output("a");
  ptys[0].output("b");
  assert.equal(socket.sent[0].type, "session.snapshot");
  const live = socket.sent.slice(1);
  assert.ok(live.every((event, index) => index === 0 || event.sequence > live[index - 1].sequence));
  assert.deepEqual(live.filter(event => event.type === "terminal.output").map(event => event.data), ["a", "b"]);
  manager.close();
});

test("subscriber failure and backpressure do not affect execution or peers", () => {
  const { manager, ptys } = fixture({ maxSocketBufferBytes: 10 });
  const healthy = client();
  const broken = client({ fail: true });
  const slow = client({ bufferedAmount: 11 });
  manager.attach({ sessionId: "isolated", display: "trace", socket: healthy });
  manager.attach({ sessionId: "isolated", display: "trace", socket: broken });
  manager.attach({ sessionId: "isolated", display: "trace", socket: slow });
  ptys[0].output("still running");
  assert.equal(healthy.sent.at(-1).data, "still running");
  assert.equal(ptys[0].killed, 0);
  assert.equal(broken.closes[0][0], 1011);
  assert.equal(slow.closes[0][0], 1013);
  manager.close();
});
