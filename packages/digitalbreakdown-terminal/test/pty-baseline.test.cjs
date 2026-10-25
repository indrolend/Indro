const test = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const net = require("node:net");
const WebSocket = require("ws");

const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

test("real WebSocket and ConPTY preserve shell editing and recovery", { timeout: 20_000 }, async t => {
  const port = await new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const selected = probe.address().port;
      probe.close(error => error ? reject(error) : resolve(selected));
    });
  });
  const server = spawn(process.execPath, ["server.cjs"], {
    cwd: process.cwd(),
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, DB_TERMINAL_PORT: String(port) }
  });
  t.after(() => server.kill());
  let startup = "";
  server.stdout.on("data", data => { startup += data; });
  server.stderr.on("data", data => { startup += data; });
  for (let attempt = 0; attempt < 100 && !startup.includes("http://"); attempt += 1) await delay(50);
  assert.match(startup, new RegExp(`http://127\\.0\\.0\\.1:${port}`));

  const projection = await fetch(`http://127.0.0.1:${port}/api/commandhud?limit=3`);
  assert.ok([200, 503].includes(projection.status));
  const projectionBody = await projection.json();
  assert.equal(projectionBody.sourceSystem, "commandhud");
  if (projection.status === 200) {
    assert.ok(Array.isArray(projectionBody.operations));
    assert.ok(projectionBody.operations.every(operation => !("command" in operation)));
  }

  const session = (await (await fetch(`http://127.0.0.1:${port}/api/session`)).json()).sessionId;
  const socket = new WebSocket(`ws://127.0.0.1:${port}/terminal?session=${session}&display=trace`, {
    origin: `http://127.0.0.1:${port}`
  });
  t.after(() => socket.close());
  let output = "";
  socket.on("message", data => {
    const raw = data.toString();
    try {
      const event = JSON.parse(raw);
      if (event.type === "session.snapshot") output += event.output || "";
      if (event.type === "terminal.output") output += event.data || "";
    } catch { output += raw; }
  });
  await new Promise((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });

  const send = data => socket.send(JSON.stringify({ type: "input", data }));
  const waitFor = async predicate => {
    for (let attempt = 0; attempt < 160; attempt += 1) {
      if (predicate(output)) return;
      await delay(50);
    }
    assert.fail(`PTY output timeout. Tail: ${output.slice(-1200)}`);
  };

  socket.send(JSON.stringify({ type: "resize", cols: 120, rows: 35 }));
  const promptVisible = value => /(?:> |❯ )$/.test(value);
  await waitFor(promptVisible);
  assert.match(output, /\x1b\]777;[A-Za-z0-9+/=]+\x07/);
  const contextMatch = output.match(/\x1b\]777;([A-Za-z0-9+/=]+)\x07/);
  const context = JSON.parse(Buffer.from(contextMatch[1], "base64").toString("utf8"));
  assert.equal(context.repository, "Indro");
  assert.match(context.cwd.replaceAll("\\", "/"), /packages\/digitalbreakdown-terminal$/);
  assert.equal(typeof context.dirty, "boolean");
  send("Write-Output $env:TERM\r");
  await waitFor(value => value.includes("xterm-256color"));
  send("Get-Command hud -ErrorAction Stop | Select-Object -ExpandProperty CommandType\r");
  await waitFor(value => value.includes("Function"));
  send("Write-Outp\t \"DB_BASELINE_α\"\r");
  await waitFor(value => value.includes("DB_BASELINE_α"));
  send("Write-Output \"BAD\x7f\x7f\x7fDB_EDIT_GOOD\"\r");
  await waitFor(value => value.includes("DB_EDIT_GOOD"));
  const beforeHistory = (output.match(/DB_EDIT_GOOD/g) || []).length;
  send("\x1b[A\r");
  await waitFor(value => (value.match(/DB_EDIT_GOOD/g) || []).length > beforeHistory);
  send("Start-Sleep -Seconds 20\r");
  await delay(400);
  send("\x03");
  await waitFor(value => promptVisible(value.slice(-300)));
  send("Write-Output \"RECOVERED\"\r");
  await waitFor(value => value.includes("RECOVERED"));
});
