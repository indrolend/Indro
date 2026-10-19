import test from "node:test";
import assert from "node:assert/strict";
import { createObservationStream, classifyInput } from "../public/observation-model.mjs";

test("observation identities are stable, ordered, and unknown fields remain null", () => {
  const captured = [];
  const stream = createObservationStream({
    sessionIdentity: "session-a",
    clock: () => "2026-10-18T00:00:00.000Z",
    onEvent: event => captured.push(event)
  });
  const event = stream.observe("terminal.input", { kind: "text", length: 1 });
  assert.equal(event.eventIdentity, "session-a:1");
  assert.equal(event.sourceRecordIdentity, null);
  assert.equal(event.operationIdentity, null);
  assert.equal(event.evidenceReference, null);
  assert.equal(event.verificationStatus, "unverified");
  assert.equal(event.historicalReplay, false);
  assert.deepEqual(captured, [event]);
});

test("input classification describes keys without retaining typed content", () => {
  assert.equal(classifyInput("x"), "text");
  assert.equal(classifyInput("\x7f"), "backspace");
  assert.equal(classifyInput("\t"), "completion-request");
  assert.equal(classifyInput("\x03"), "interrupt");
  assert.equal(classifyInput("\r"), "submit-key");
});

test("clipboard observations retain representation and length without content", () => {
  const stream = createObservationStream({ sessionIdentity: "session-clipboard" });
  const event = stream.observe("clipboard.copy", { mode: "raw", length: 42 });
  assert.deepEqual(event.observedState, { mode: "raw", length: 42 });
  assert.equal("text" in event.observedState, false);
});

test("retained CommandHUD operations retain their source identity and replay status", () => {
  const stream = createObservationStream({ sessionIdentity: "session-commandhud" });
  const event = stream.observe("commandhud.operation", { type: "lint", status: "pass", evidence: "STALE" }, {
    sourceRecordIdentity: "run-42", historicalReplay: true
  });
  assert.equal(event.sourceRecordIdentity, "run-42");
  assert.equal(event.historicalReplay, true);
  assert.equal(event.verificationStatus, "unverified");
});

test("evidence expansion retains source identity without retaining its text", () => {
  const stream = createObservationStream({ sessionIdentity: "session-evidence" });
  const event = stream.observe("commandhud.evidence.expanded", { mode: "tail", count: 25 }, {
    sourceRecordIdentity: "run-42", historicalReplay: true
  });
  assert.equal(event.sourceRecordIdentity, "run-42");
  assert.deepEqual(event.observedState, { mode: "tail", count: 25 });
});
