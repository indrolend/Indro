const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const pty = require("node-pty");
const path = require("path");
const { createCommandHudReader } = require("./commandhud-adapter.cjs");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({
  server,
  path: "/terminal",
  maxPayload: 65536
});

const HOST = "127.0.0.1";
const configuredPort = Number(process.env.DB_TERMINAL_PORT || 8765);
const PORT = Number.isInteger(configuredPort) && configuredPort >= 1024 && configuredPort <= 65535
  ? configuredPort
  : 8765;

app.use("/node_modules/@xterm", express.static(path.join(__dirname, "node_modules/@xterm")));
app.use(express.static(path.join(__dirname, "public")));

const commandHud = createCommandHudReader();
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

wss.on("connection", (socket, request) => {
  const origin = request.headers.origin;
  if (origin !== `http://${HOST}:${PORT}`) {
    socket.close(1008, "Invalid origin");
    return;
  }

  const shell = pty.spawn("pwsh.exe", ["-NoLogo"], {
    name: "xterm-256color",
    cols: 100,
    rows: 30,
    cwd: process.env.USERPROFILE || process.cwd(),
    env: process.env,
    useConpty: true
  });

  const subscription = shell.onData(data => {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(data);
    }
  });

  socket.on("message", raw => {
    try {
      const msg = JSON.parse(raw.toString());

      if (msg.type === "input" && typeof msg.data === "string") {
        if (msg.data.length <= 65536) shell.write(msg.data);
      }

      if (msg.type === "resize") {
        const cols = Number(msg.cols);
        const rows = Number(msg.rows);

        if (
          Number.isInteger(cols) && Number.isInteger(rows) &&
          cols >= 10 && cols <= 500 &&
          rows >= 4 && rows <= 200
        ) {
          shell.resize(cols, rows);
        }
      }
    } catch (error) {
      console.error("Terminal message error:", error.message);
    }
  });

  socket.on("close", () => {
    subscription.dispose();
    shell.kill();
  });

  shell.onExit(() => {
    if (socket.readyState === WebSocket.OPEN) socket.close();
  });
});

server.listen(PORT, HOST, () => {
  console.log(`Digital Breakdown Terminal: http://${HOST}:${PORT}`);
});

