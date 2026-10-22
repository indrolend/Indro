import test from "node:test";
import assert from "node:assert/strict";
import { compactPath, contextView, decodeContextPayload } from "../public/context-projection.mjs";

function encode(value) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64");
}

test("shell context decodes without interpreting terminal text", () => {
  const context = decodeContextPayload(encode({
    cwd: "C:\\work\\repo\\packages\\terminal",
    repository: "repo",
    repositoryRoot: "C:\\work\\repo",
    branch: "feature/context",
    dirty: true,
    exitCode: 1,
    shell: "PowerShell 7.6.0"
  }));
  assert.equal(context.repository, "repo");
  assert.equal(context.branch, "feature/context");
  assert.equal(context.dirty, true);
  assert.equal(context.exitCode, 1);
  assert.equal(compactPath(context.cwd, context.repositoryRoot), "repo/packages/terminal");
});

test("context view handles clean, dirty, and non-Git locations", () => {
  assert.equal(contextView({ cwd: "/tmp", repository: null }, {}).repository, "NO REPOSITORY");
  assert.equal(contextView({ cwd: "/repo", repository: "repo", dirty: false }, {}).dirty, "CLEAN");
  assert.equal(contextView({ cwd: "/repo", repository: "repo", dirty: true }, {}).dirty, "DIRTY");
});

test("malformed metadata is ignored", () => {
  assert.equal(decodeContextPayload("not-base64"), null);
  assert.equal(decodeContextPayload(encode({ branch: "main" })), null);
});
