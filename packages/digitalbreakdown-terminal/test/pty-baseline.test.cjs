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
  if (process.env.DB_TERMINAL_EXPECT_COMMANDHUD_ID) {
    assert.equal(projectionBody.repository.identity, process.env.DB_TERMINAL_EXPECT_COMMANDHUD_ID);
  }
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
    const requests = (output.match(/\x1b\[6n/g) || []).length;
    while (cursorReplies < requests) {
      cursorReplies += 1;
      socket.send(JSON.stringify({ type: "input", data: "\x1b[1;1R" }));
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
  const promptCount = value => (value.match(/\x1b\]777;[A-Za-z0-9+/=]+\x07/g) || []).length;
  await waitFor(value => promptCount(value) >= 1 && /PS [^\r\n]*> /.test(value.slice(-500)));
  const contextMatch = output.match(/\x1b\]777;([A-Za-z0-9+/=]+)\x07/);
  const context = JSON.parse(Buffer.from(contextMatch[1], "base64").toString("utf8"));
  assert.equal(context.repository, "Indro");
  assert.match(context.cwd.replaceAll("\\", "/"), /packages\/digitalbreakdown-terminal$/);
  assert.equal(typeof context.dirty, "boolean");

  // Echoed input is not proof that a command completed. Each prompt emits a
  // fresh OSC marker; wait for that temporal boundary before the next input.
  const sendAndWait = async data => {
    const before = promptCount(output);
    send(data);
    await waitFor(value => promptCount(value) > before);
  };
  await sendAndWait("Write-Output $env:TERM\r");
  assert.match(output, /xterm-256color/);
  await sendAndWait("Get-Command hud -ErrorAction Stop | Select-Object -ExpandProperty CommandType\r");
  assert.match(output, /Function/);
  await sendAndWait("Write-Outp\t \"DB_BASELINE_α\"\r");
  assert.match(output, /DB_BASELINE_α/);
  await sendAndWait("Write-Output \"BAD\x7f\x7f\x7fDB_EDIT_GOOD\"\r");
  assert.match(output, /DB_EDIT_GOOD/);
  const beforeHistory = (output.match(/DB_EDIT_GOOD/g) || []).length;
  send("\x1b[A");
  await waitFor(value => (value.match(/DB_EDIT_GOOD/g) || []).length > beforeHistory);
  await sendAndWait("\r");
  const beforeInterrupt = promptCount(output);
  send("Start-Sleep -Seconds 20\r");
  await delay(400);
  send("\x03");
  await waitFor(value => promptCount(value) > beforeInterrupt);
  await sendAndWait("Write-Output \"RECOVERED\"\r");
  assert.match(output, /RECOVERED/);
});
