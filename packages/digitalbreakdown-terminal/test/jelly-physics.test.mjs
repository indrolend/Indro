import test from "node:test";
import assert from "node:assert/strict";
import { jellyTransform, createJellyState, MAX_DISPLACEMENT } from "../public/jelly-physics.mjs";

test("original jelly deformation at birth", () => {
  const t = jellyTransform(0);
  assert.equal(t.sx, 1.25);
  assert.equal(t.sy, 0.8);
  assert.equal(t.dy, 2.5);
});

test("spring motion stays downward and bounded until it settles", () => {
  for (let age = 0; age <= 0.72; age += 0.001) {
    const transform = jellyTransform(age);
    assert.ok(transform.dy >= 0 && transform.dy <= MAX_DISPLACEMENT);
    assert.ok(transform.sx >= 0.72 && transform.sx <= 1.28);
    assert.ok(transform.sy >= 0.72 && transform.sy <= 1.28);
  }
});

test("jelly returns to ordinary geometry after 0.72 seconds", () => {
  assert.deepEqual(jellyTransform(0.72), { sx: 1, sy: 1, dy: 0 });
});

test("glyph identity change restarts animation", () => {
  const state = createJellyState();
  state.update(0, 0, "A", 0);
  assert.equal(state.update(0, 0, "A", 1).sx, 1);
  assert.equal(state.update(0, 0, "B", 1).sx, 1.25);
});
