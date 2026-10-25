const crypto = require("node:crypto");

const OPEN = 1;
const CONTEXT_PATTERN = /\x1b\]777;([A-Za-z0-9+/=]+)\x07/g;

function validSessionId(value) {
  return /^[a-zA-Z0-9_-]{1,96}$/.test(String(value || ""));
}

function decodeContext(encoded) {
  try {
    const value = JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
    if (!value || typeof value.cwd !== "string") return null;
    return value;
  } catch {
    return null;
  }
}

function createSessionManager({
  spawnPty,
  now = () => Date.now(),
  idleTimeoutMs = 5 * 60_000,
  sweepIntervalMs = 30_000,
  maxOutputBytes = 2 * 1024 * 1024,
  maxEvents = 2048,
  maxSocketBufferBytes = 512 * 1024,
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval
}) {
  if (typeof spawnPty !== "function") throw new TypeError("spawnPty is required");
  const sessions = new Map();

  function safeSend(client, payload) {
    const socket = client.socket;
    if (socket.readyState !== undefined && socket.readyState !== OPEN) return false;
    if (Number(socket.bufferedAmount || 0) > maxSocketBufferBytes) {
      try { socket.close(1013, "Subscriber is too slow"); } catch {}
      return false;
    }
    try {
      socket.send(JSON.stringify(payload));
      return true;
    } catch {
      try { socket.close(1011, "Subscriber failure"); } catch {}
      return false;
    }
  }

  function snapshot(session) {
    return {
      type: "session.snapshot",
      sessionId: session.id,
      sequence: session.sequence,
      state: { ...session.state },
      output: session.output,
      outputTruncated: session.outputTruncated,
      events: session.events.map(event => ({ ...event }))
    };
  }

  function publish(session, type, data = {}) {
    const event = Object.freeze({
      type,
      sessionId: session.id,
      sequence: ++session.sequence,
      timestamp: new Date(now()).toISOString(),
      ...data
    });
    session.events.push(event);
    if (session.events.length > maxEvents) session.events.splice(0, session.events.length - maxEvents);
    for (const client of session.clients) {
      if (type === "terminal.output" && client.display !== "trace") continue;
      safeSend(client, event);
    }
    return event;
  }

  function appendOutput(session, data) {
    session.output += data;
    while (Buffer.byteLength(session.output, "utf8") > maxOutputBytes && session.output.length) {
      session.output = session.output.slice(Math.max(1, Math.floor(session.output.length / 8)));
      session.outputTruncated = true;
    }
  }

  function create(id) {
    const pty = spawnPty();
    const session = {
      id,
      pty,
      clients: new Set(),
      sequence: 0,
      events: [],
      output: "",
      outputTruncated: false,
      contextTail: "",
      idleSince: null,
      closed: false,
      state: { execution: "ready", context: null, exit: null }
    };
    sessions.set(id, session);
    session.dataSubscription = pty.onData(data => {
      const text = String(data);
      appendOutput(session, text);
      const contextSource = session.contextTail + text;
      let match;
      let contextEnd = 0;
      CONTEXT_PATTERN.lastIndex = 0;
      while ((match = CONTEXT_PATTERN.exec(contextSource))) {
        contextEnd = CONTEXT_PATTERN.lastIndex;
        const context = decodeContext(match[1]);
        if (context) {
          session.state.context = context;
          session.state.execution = "ready";
          publish(session, "signal.state", { state: { ...session.state }, reason: "prompt" });
          if (!session.clients.size) session.idleSince = now();
        }
      }
      session.contextTail = contextSource.slice(contextEnd || Math.max(0, contextSource.length - 4096)).slice(-4096);
      publish(session, "terminal.output", { data: text, verificationStatus: "unverified" });
    });
    session.exitSubscription = pty.onExit(result => {
      session.state.execution = "exited";
      session.state.exit = result?.exitCode ?? null;
      publish(session, "session.exited", { exitCode: session.state.exit });
      if (!session.clients.size) session.idleSince = now();
    });
    publish(session, "session.created", {});
    return session;
  }

  function getOrCreate(id) {
    if (!validSessionId(id)) throw new TypeError("Invalid session identity");
    return sessions.get(id) || create(id);
  }

  function attach({ sessionId, display, socket }) {
    if (!['trace', 'signal'].includes(display)) throw new TypeError("Invalid display role");
    const session = getOrCreate(sessionId);
    const client = { socket, display };
    session.clients.add(client);
    session.idleSince = null;
    const initial = snapshot(session);
    if (display === "signal") {
      initial.output = "";
      initial.events = initial.events.filter(event => event.type !== "terminal.output");
    }
    safeSend(client, initial);
    publish(session, "subscriber.connected", { display });
    return {
      session,
      receive(raw) {
        let message;
        try { message = JSON.parse(String(raw)); } catch { return; }
        if (display !== "trace") {
          publish(session, "subscriber.rejected", { display, attemptedType: message.type || null });
          return;
        }
        if (message.type === "shutdown") {
          shutdown(sessionId, "explicit");
          return;
        }
        if (message.type === "input" && typeof message.data === "string" && Buffer.byteLength(message.data, "utf8") <= 65536) {
          if (message.data.includes("\r") || message.data.includes("\n")) {
            session.state.execution = "running";
            publish(session, "signal.state", { state: { ...session.state }, reason: "input" });
          }
          session.pty.write(message.data);
        } else if (message.type === "resize") {
          const cols = Number(message.cols);
          const rows = Number(message.rows);
          if (Number.isInteger(cols) && Number.isInteger(rows) && cols >= 10 && cols <= 500 && rows >= 4 && rows <= 200) {
            session.pty.resize(cols, rows);
          }
        }
      },
      detach() {
        if (!session.clients.delete(client)) return;
        publish(session, "subscriber.disconnected", { display });
        if (!session.clients.size && session.state.execution !== "running") session.idleSince = now();
      }
    };
  }

  function shutdown(id, reason = "explicit") {
    const session = sessions.get(id);
    if (!session || session.closed) return false;
    session.closed = true;
    publish(session, "session.shutdown", { reason });
    try { session.dataSubscription?.dispose(); } catch {}
    try { session.exitSubscription?.dispose(); } catch {}
    try { session.pty.kill(); } catch {}
    for (const client of session.clients) {
      try { client.socket.close(1000, "Session shutdown"); } catch {}
    }
    session.clients.clear();
    sessions.delete(id);
    return true;
  }

  function sweep() {
    const cutoff = now() - idleTimeoutMs;
    for (const session of sessions.values()) {
      if (!session.clients.size && session.idleSince !== null && session.idleSince <= cutoff) shutdown(session.id, "idle");
    }
  }

  const sweeper = setIntervalFn(sweep, sweepIntervalMs);
  sweeper?.unref?.();
  return Object.freeze({
    attach,
    shutdown,
    sweep,
    snapshot(id) { const session = sessions.get(id); return session ? snapshot(session) : null; },
    sessionCount() { return sessions.size; },
    close() {
      clearIntervalFn(sweeper);
      for (const id of [...sessions.keys()]) shutdown(id, "manager-close");
    }
  });
}

function randomSessionId() {
  return crypto.randomBytes(18).toString("base64url");
}

module.exports = { createSessionManager, decodeContext, randomSessionId, validSessionId };
