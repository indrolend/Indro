import test from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync, execFileSync } from "node:child_process";
import { createServer } from "node:net";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import WebSocket from "ws";

async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => server.once("error", reject).listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

async function until(probe, label, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const result = await probe();
      if (result) return result;
    } catch {}
    await sleep(150);
  }
  throw new Error("Timed out: " + label);
}

function chromeExecutable() {
  for (const candidate of ["google-chrome", "chromium", "chromium-browser"]) {
    if (spawnSync(candidate, ["--version"], { stdio: "ignore" }).status === 0) return candidate;
  }
  throw new Error("Chromium/Chrome is required for the actual xterm browser test");
}

function connectCdp(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    const pending = new Map();
    let nextId = 1;
    socket.once("error", reject);
    socket.once("open", () => {
      socket.on("message", raw => {
        const message = JSON.parse(raw.toString());
        const item = pending.get(message.id);
        if (!item) return;
        pending.delete(message.id);
        clearTimeout(item.timer);
        if (message.error) item.reject(new Error(JSON.stringify(message.error)));
        else item.resolve(message.result);
      });
      resolve({
        async send(method, params = {}) {
          const id = nextId++;
          return new Promise((ok, fail) => {
            const timer = setTimeout(() => {
              pending.delete(id);
              fail(new Error("CDP timeout: " + method));
            }, 10000);
            pending.set(id, { resolve: ok, reject: fail, timer });
            socket.send(JSON.stringify({ id, method, params }));
          });
        },
        close() { socket.close(); }
      });
    });
  });
}

test("actual xterm 6 and PowerShell PTY preserve reported provenance and transport state", { timeout: 90000 }, async () => {
  const temp = await mkdtemp(path.join(tmpdir(), "indro-xterm-"));
  const repo = path.join(temp, "repo");
  const subdir = path.join(repo, "subdir");
  let server;
  let browser;
  let cdp;
  let serverLog = "";
  try {
    await mkdir(subdir, { recursive: true });
    execFileSync("git", ["init", "-q", repo]);
    execFileSync("git", ["-C", repo, "-c", "user.name=INDRO", "-c", "user.email=indro@example.invalid", "commit", "--allow-empty", "-qm", "baseline"]);
    const port = await freePort();
    const chromePort = await freePort();
    server = spawn(process.execPath, ["server.cjs"], {
      cwd: process.cwd(),
      env: { ...process.env, DB_TERMINAL_PORT: String(port), DB_TERMINAL_CWD: repo },
      stdio: ["ignore", "pipe", "pipe"]
    });
    for (const stream of [server.stdout, server.stderr]) {
      stream.on("data", chunk => { serverLog = (serverLog + chunk.toString()).slice(-4000); });
    }
    await until(async () => (await fetch("http://127.0.0.1:" + port + "/?visuals=off")).ok, "terminal server");
    browser = spawn(chromeExecutable(), [
      "--headless=new", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage",
      "--no-first-run", "--no-default-browser-check",
      "--remote-debugging-port=" + chromePort,
      "--user-data-dir=" + path.join(temp, "chrome"),
      "http://127.0.0.1:" + port + "/?visuals=off"
    ], { stdio: "ignore" });
    const target = await until(async () => {
      const response = await fetch("http://127.0.0.1:" + chromePort + "/json/list");
      if (!response.ok) return null;
      return (await response.json()).find(page => page.type === "page" && page.url.includes("127.0.0.1:" + port));
    }, "Chrome CDP page");
    cdp = await connectCdp(target.webSocketDebuggerUrl);
    await cdp.send("Runtime.enable");
    async function evaluate(expression) {
      const result = await cdp.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
      if (result.exceptionDetails) throw new Error("Browser evaluation failed: " + JSON.stringify(result.exceptionDetails));
      return result.result.value;
    }
    const value = id => evaluate("document.getElementById(" + JSON.stringify(id) + ")?.textContent");
    const enter = async () => {
      const key = { key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 };
      await cdp.send("Input.dispatchKeyEvent", { ...key, type: "keyDown" });
      await cdp.send("Input.dispatchKeyEvent", { ...key, type: "keyUp" });
    };
    const command = async text => {
      await evaluate("document.querySelector('.xterm-helper-textarea').focus()");
      await cdp.send("Input.insertText", { text });
      await enter();
    };
    try {
      await until(async () => await evaluate("!!document.querySelector('.xterm')") && await value("connection-status") === "SIGNAL ACTIVE", "real xterm and websocket");
    } catch (error) {
      const diagnostic = await evaluate("JSON.stringify({url:location.href,ready:document.readyState,xterm:!!document.querySelector('.xterm'),canvas:!!document.querySelector('.xterm-screen canvas'),connection:document.getElementById('connection-status')?.textContent,body:document.body.innerText.slice(0,500)})");
      throw new Error(error.message + " Browser: " + diagnostic);
    }
    await until(async () => (await value("context-repository")) === "REPORTED repo", "actual PowerShell Git prompt");
    assert.equal(await value("context-dirty"), "REPORTED CLEAN");
    const payload = Buffer.from(JSON.stringify({
      cwd: "/tmp/fabricated", repository: "fabricated", repositoryRoot: "/tmp/fabricated",
      branch: "forged", dirty: false, exitCode: 0, shell: "PowerShell forged"
    }), "utf8").toString("base64");
    await command('[Console]::Write("$([char]27)]777;' + payload + '$([char]7)"); Start-Sleep -Seconds 3; Write-Output INDRO_OSC_COMPLETE');
    await until(async () => (await value("context-repository")) === "REPORTED fabricated", "forged OSC 777 through real xterm and PTY");
    assert.equal(await value("context-branch"), "REPORTED forged");
    assert.equal(await value("context-dirty"), "REPORTED CLEAN");
    assert.equal(await value("exit-status"), "REPORTED EXIT 0");
    assert.equal(await value("execution-status"), "REPORTED READY");
    await until(async () => (await value("context-repository")) === "REPORTED repo", "real prompt restores Git context");
    await command("Set-Location " + JSON.stringify(subdir));
    await until(async () => (await value("context-location")) === "repo/subdir", "normal PTY command changes directory");
    await command("exit");
    await until(async () => (await value("execution-status")) === "DISCONNECTED", "PTY exit closes transport");
    await enter();
    await sleep(250);
    assert.equal(await value("execution-status"), "DISCONNECTED", "disconnected keyboard input cannot imply a running process");
    console.log("PASS actual xterm 6, real PowerShell prompt, forged OSC, normal PTY input, disconnect negative control");
  } catch (error) {
    throw new Error(error.message + "\nServer tail:\n" + serverLog);
  } finally {
    cdp?.close();
    browser?.kill();
    server?.kill();
    await sleep(250);
    await rm(temp, { recursive: true, force: true });
  }
});
