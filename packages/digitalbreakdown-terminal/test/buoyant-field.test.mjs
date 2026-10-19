import test from "node:test";
import assert from "node:assert/strict";
import { BuoyantField, energyForObservation } from "../public/buoyant-field.mjs";

test("field evolution is deterministic and bounded for controlled input", () => {
  const left = new BuoyantField(32);
  const right = new BuoyantField(32);
  left.disturb(0.5, 1);
  right.disturb(0.5, 1);
  for (let frame = 0; frame < 120; frame += 1) {
    left.step(1 / 60);
    right.step(1 / 60);
  }
  assert.deepEqual([...left.height], [...right.height]);
  assert.ok(left.height.every(Number.isFinite));
});

test("historical replay never creates live visual evidence", () => {
  assert.equal(energyForObservation({
    historicalReplay: true,
    eventType: "terminal.input",
    observedState: { kind: "text", length: 10 }
  }), 0);
  assert.ok(energyForObservation({
    historicalReplay: false,
    eventType: "terminal.input",
    observedState: { kind: "text", length: 1 }
  }) > 0);
});
