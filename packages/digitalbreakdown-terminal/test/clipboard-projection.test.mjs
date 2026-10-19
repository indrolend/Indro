import test from "node:test";
import assert from "node:assert/strict";
import { createClipboardProjection, clipboardObservedState } from "../public/clipboard-projection.mjs";

test("raw clipboard projection is byte-for-byte unchanged", () => {
  const source = "PS> Write-Output α\r\nresult\r\n";
  assert.equal(createClipboardProjection(source, "raw"), source);
});

test("fenced projection cannot be closed by backticks in selected text", () => {
  const source = "output with ``` inside";
  const projected = createClipboardProjection(source, "fenced");
  assert.match(projected, /^````text\n/);
  assert.match(projected, /\n````$/);
});

test("clipboard observation metadata excludes clipboard content", () => {
  assert.deepEqual(clipboardObservedState("fenced", "secret"), { mode: "fenced", length: 6 });
});
