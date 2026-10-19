import test from "node:test";
import assert from "node:assert/strict";
import { particleMorphFrames } from "../public/semantic-morph.mjs";

test("particle morph retains compact and expanded endpoints at a stable width", () => {
  const frames = particleMorphFrames("PASS", "exit 0 · evidence CURRENT");
  assert.equal(frames.length, 5);
  assert.equal(frames[0].trimEnd(), "PASS");
  assert.equal(frames.at(-1).trimEnd(), "exit 0 · evidence CURRENT");
  assert.equal(new Set(frames.map(frame => frame.length)).size, 1);
});
