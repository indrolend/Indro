const path = require("node:path");

function terminalShell({ platform = process.platform, directory = __dirname } = {}) {
  const windows = platform === "win32";
  const pathApi = windows ? path.win32 : path.posix;
  return {
    executable: windows ? "pwsh.exe" : "pwsh",
    args: ["-NoLogo", "-NoExit", "-File", pathApi.join(directory, "shell-init.ps1")],
    options: windows ? { useConpty: true } : {}
  };
}

module.exports = { terminalShell };
