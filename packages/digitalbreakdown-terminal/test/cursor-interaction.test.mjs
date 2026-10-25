import test from "node:test";
import assert from "node:assert/strict";
import { quotePowerShellPath, droppedText } from "../public/cursor-interaction.mjs";

test("PowerShell paths are quoted without execution", () => {
  assert.equal(quotePowerShellPath("C:\\A B\\it's.txt"), "'C:\\A B\\it''s.txt'");
  assert.throws(() => quotePowerShellPath("a\nb"), TypeError);
});
test("text drop preserves input exactly", () => {
  assert.equal(droppedText({ files: [], getData: () => "hello world" }), "hello world");
});
test("file drop does not invent inaccessible browser paths", () => {
  assert.equal(droppedText({ files: [{ name: "example.txt" }], getData: () => "ignored" }), "");
});
test("file paths remain quoted and separated", () => {
  const files = [{ path: "C:\\one.txt" }, { path: "C:\\two words.txt" }];
  assert.equal(droppedText({ files }), "'C:\\one.txt' 'C:\\two words.txt'");
});
