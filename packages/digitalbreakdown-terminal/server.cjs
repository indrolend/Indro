const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const pty = require("node-pty");
const path = require("path");
const { createCommandHudReader } = require("./commandhud-adapter.cjs");
const { terminalEnvironment } = require("./terminal-environment.cjs");
const { terminalShell } = require("./terminal-shell.cjs");
const { createSessionManager, randomSessionId, validSessionId } = require("./session-manager.cjs");

const HOST = "127.0.0.1";
const configuredPort = Number(process.env.DB_TERMINAL_PORT || 8765);
const PORT = Number.isInteger(configuredPort) && configuredPort >= 1024 && configuredPort <= 65535
  ? configuredPort
  : 8765;

function createTerminalServer({ ptyModule = pty, env = process.env } = {}) {
  const app = express();
  const server = http.createServer(app);
  const wss = new WebSocket.Server({ server, path: "/terminal", maxPayload: 65536 });
  app.use("/node_modules/@xterm", express.static(path.join(__dirname, "node_modules/@xterm")));
  app.use(express.static(path.join(__dirname, "public")));

  const commandHud = createCommandHudReader({ env });
  app.get("/api/session", (_request, response) => response.json({ sessionId: randomSessionId() }));
  app.get("/api/commandhud", async (request, response) => {
  try {
    response.json(await commandHud.snapshot(request.query.limit));
  } catch {
    response.status(503).json({ sourceSystem: "commandhud", available: false, reason: "Read-only CommandHUD projection is unavailable." });
  }
  });

  app.get("/api/commandhud/evidence/:runId", async (request, response) => {
  try {
    response.json(await commandHud.evidence(request.params.runId, request.query));
  } catch {
    response.status(404).json({ sourceSystem: "commandhud", available: false, reason: "Retained evidence is unavailable." });
  }
  });

  const manager = createSessionManager({
  idleTimeoutMs: Number(env.DB_TERMINAL_IDLE_MS) || 5 * 60_000,
  spawnPty() {
    const shellSpec = terminalShell();
    return ptyModule.spawn(shellSpec.executable, shellSpec.args, {
      name: "xterm-256color", cols: 100, rows: 30,
      cwd: env.DB_TERMINAL_CWD || process.cwd(),
      env: terminalEnvironment(env), ...shellSpec.options
    });
  }
  });

  wss.on("connection", (socket, request) => {
  const origin = request.headers.origin;
  const address = server.address();
  const expectedOrigin = `http://${HOST}:${typeof address === "object" ? address.port : PORT}`;
  if (origin !== expectedOrigin) {
    socket.close(1008, "Invalid origin");
    return;
  }
  const url = new URL(request.url, expectedOrigin);
  const sessionId = url.searchParams.get("session");
  const display = url.searchParams.get("display");
  if (!validSessionId(sessionId) || !["trace", "signal"].includes(display)) return socket.close(1008, "Invalid session request");
  let connection;
  try { connection = manager.attach({ sessionId, display, socket }); }
  catch { return socket.close(1011, "Session unavailable"); }
  socket.on("message", raw => connection.receive(raw));
  socket.on("close", () => connection.detach());
  });

  server.on("close", () => manager.close());
  return { app, server, wss, manager };
}

if (require.main === module) {
  const runtime = createTerminalServer();
  runtime.server.listen(PORT, HOST, () => console.log(`INDRO TRACE + SIGNAL: http://${HOST}:${PORT}`));
}

module.exports = { createTerminalServer, HOST, PORT };

