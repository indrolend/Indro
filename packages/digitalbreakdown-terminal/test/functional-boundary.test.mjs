import test from "node:test";
import assert from "node:assert/strict";
import { runFunctionalThenObserve, safeVisualCall } from "../public/functional-boundary.mjs";

test("a failed observation cannot undo completed terminal I/O", () => {
  const calls = [];
  const result = runFunctionalThenObserve(
    () => { calls.push("pty.write"); return "sent"; },
    () => { calls.push("visual.observe"); throw new Error("render failure"); }
  );
  assert.equal(result, "sent");
  assert.deepEqual(calls, ["pty.write", "visual.observe"]);
});

test("a failed visual effect is disposable", () => {
  const visual = { play() { throw new Error("animation failure"); } };
  assert.equal(safeVisualCall(visual, "play", {}), undefined);
  assert.equal(safeVisualCall(null, "play", {}), undefined);
});
