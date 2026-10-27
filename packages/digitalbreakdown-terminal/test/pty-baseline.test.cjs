const test = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const net = require("node:net");
const WebSocket = require("ws");

const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

test("real WebSocket and PTY preserve shell editing and recovery", { timeout: 20_000 }, async t => {
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
  const projectionBody = await projection.json();
  assert.equal(projection.status, 200, JSON.stringify(projectionBody));
  assert.equal(projectionBody.sourceSystem, "commandhud");
  assert.ok(Array.isArray(projectionBody.operations));
  assert.ok(projectionBody.operations.every(operation => !("command" in operation)));

  const socket = new WebSocket(`ws://127.0.0.1:${port}/terminal`, {
    origin: `http://127.0.0.1:${port}`
  });
  t.after(() => socket.close());
  let output = "";
  let cursorReplies = 0;
  socket.on("message", data => {
    output += data.toString();
    // PSReadLine asks the terminal for its cursor position on Unix PTYs.
    // A real xterm client answers CSI 6n; this test client must do the same.
    const requests = (output.match(/\\x1b\\[6n/g) || []).length;
    while (cursorReplies < requests) {
      cursorReplies += 1;
      socket.send(JSON.stringify({ type: "input", data: "\\x1b[1;1R" }));
    }
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
