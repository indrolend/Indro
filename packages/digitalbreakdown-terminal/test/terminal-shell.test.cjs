const test = require("node:test");
const assert = require("node:assert/strict");
const { terminalShell } = require("../terminal-shell.cjs");

test("terminal chooses PowerShell and ConPTY only on Windows", () => {
  const windows = terminalShell({ platform: "win32", directory: "C:\\terminal" });
  assert.equal(windows.executable, "pwsh.exe");
  assert.equal(windows.options.useConpty, true);
  const mac = terminalShell({ platform: "darwin", directory: "/terminal" });
  assert.equal(mac.executable, "pwsh");
  assert.deepEqual(mac.options, {});
  assert.deepEqual(mac.args, ["-NoLogo", "-NoExit", "-File", "/terminal/shell-init.ps1"]);
});
