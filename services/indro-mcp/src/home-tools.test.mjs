import test from "node:test";
import assert from "node:assert/strict";
import { callHome } from "./home-tools.ts";

const env = (suffix) => ({
  HOME_EXECUTOR_TOKEN: "test-token",
  HOME_EXECUTOR_URL: `https://home.invalid/${suffix}`,
});

test("read-only home calls retry bounded 429 responses", async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => { globalThis.fetch = originalFetch; });
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    if (calls < 3) return new Response("busy", { status: 429, headers: { "Retry-After": "0" } });
    return Response.json({ status: "ready" });
  };
  assert.deepEqual(await callHome(env("retry"), "/projects"), { status: "ready" });
  assert.equal(calls, 3);
});

test("mutating home calls are never retried", async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => { globalThis.fetch = originalFetch; });
  let calls = 0;
  globalThis.fetch = async () => { calls++; return new Response("busy", { status: 429 }); };
  await assert.rejects(
    () => callHome(env("mutation"), "/agents/start", { method: "POST", body: "{}" }),
    /HTTP 429/,
  );
  assert.equal(calls, 1);
});

test("short read cache coalesces repeated project discovery", async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => { globalThis.fetch = originalFetch; });
  let calls = 0;
  globalThis.fetch = async () => { calls++; return Response.json({ projects: ["data-game"] }); };
  const target = env("cache");
  const [first, second] = await Promise.all([
    callHome(target, "/projects", undefined, 5000),
    callHome(target, "/projects", undefined, 5000),
  ]);
  assert.deepEqual(first, second);
  assert.equal(calls, 1);
});
