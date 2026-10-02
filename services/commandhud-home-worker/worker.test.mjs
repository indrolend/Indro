import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { test } from "node:test";

test("home executor requires authentication and advertises bounded mobile capabilities", async (t) => {
  const port = 18000 + (process.pid % 1000);
  const token = "fixture-home-token";
  const child = spawn(process.execPath, [new URL("./worker.mjs", import.meta.url).pathname.slice(process.platform === "win32" ? 1 : 0)], {
    env: { ...process.env, COMMANDHUD_HOME_PORT: String(port), COMMANDHUD_HOME_TOKEN: token },
    windowsHide: true,
  });
  t.after(() => child.kill());
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk; });
  const deadline = Date.now() + 10_000;
  while (!output.includes("listening") && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 50));
  if (!output.includes("listening")) {
    child.kill();
    await once(child, "close");
    assert.fail("home executor did not start");
  }
  const unauthorized = await fetch(`http://127.0.0.1:${port}/health`);
  assert.equal(unauthorized.status, 401);
  const authorized = await fetch(`http://127.0.0.1:${port}/health`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(authorized.status, 200);
  const health = await authorized.json();
  assert.deepEqual(health.capabilities, ["commandhud.lifecycle", "brokeman.result", "brokeman.packet"]);
});
