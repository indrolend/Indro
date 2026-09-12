# CommandHUD

Local-first command runner and context condenser for repository work.

`packages/commandhud/` is the runtime. `hud` and `commandhud` both run `packages/commandhud/cli.mjs`.

## Run

Requires Node.js 20+, Git, and a supported shell.

```powershell
npm install --global .
hud tui
```

Windows launchers are also included for TUI, shell, and desktop clients.

## Test

```powershell
npm test
```
