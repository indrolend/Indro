# Indro

An evidence-native, semantically compressed programming language for human-directed and agent-assisted software development.

Indro compiles typed development intent into deterministic, effect-checked plans. Its integrated CommandHUD runtime runs real commands inside verified Git repositories, preserves complete evidence, and produces compact context for humans and language models. Git, the filesystem, the selected shell, and repository-owned scripts remain authoritative.

## The language

Readable and compact source compile to the same semantic plan ID:

```indro
@repair
!"repair ${target}, prove the change, and retain evidence"
$target:path
+rwx

:main
  >o
  >ck
  >p ${target}
  ?"tests pass for ${target}"
```

```powershell
indro compile packages/indro/examples/repair.i --set target=src/audio.cpp --allow-effect write
indro proof-plan verified --state packages/indro/examples/proof-state.json
```

Indro provides typed parameters, intent declarations, nested semantic words, parallel and recovery plans, assertions, evidence events, deterministic compact IR, static effect inference, two-layer authority checks, and content-addressed proof planning. Consequential actions cannot be hidden inside abstractions.

## Current authority

`packages/indro/` owns the language compiler, semantic IR, proof planner, compact syntax, and language benchmarks. `packages/commandhud/` is Indro's execution and evidence substrate. It owns:

- PowerShell, Bash, Zsh, and Cmd command execution;
- persistent repository-contained working directories;
- immutable stdout/stderr and Git before/after evidence;
- deterministic context reduction and automatic clipboard export;
- Search, operation history, safe worktree Undo, and command discovery;
- the terminal UI, local desktop host, and visual repository client.

Earlier Windows Forms, DataFactory/VS Code, and portable distribution prototypes were removed after their behavior was accounted for. Git history retains their exact source; [the retirement audit](docs/PROTOTYPE-RETIREMENT-AUDIT.md) records what was adopted, superseded, or deliberately rejected.

## Requirements

- Node.js 20 or newer
- Git
- at least one supported shell
- optional: `rg` for repository Search

## Use it now

From the Git repository you want to operate on, launch the fixed terminal UI:

```powershell
& 'C:\path\to\Indro\CommandHUD-TUI.cmd'
```

The launcher attaches to the current Git repository. Paste an ordinary command at the prompt; the full output is retained and the condensed result is shown and copied automatically.

Open the Repository Map desktop client from the current repository:

```powershell
& 'C:\path\to\Indro\CommandHUD-Desktop.cmd'
```

`CommandHUD.cmd` is the Windows compatibility launcher for the complete CLI. Select clients explicitly:

```powershell
& 'C:\path\to\Indro\CommandHUD.cmd' tui
& 'C:\path\to\Indro\CommandHUD.cmd' shell
& 'C:\path\to\Indro\CommandHUD.cmd' desktop
```

All launchers use the current directory as the default Git root and preserve `--root <path>` and other client arguments. With no command, `CommandHUD.cmd` has the same context behavior as `hud` and `commandhud`. The historical `CommandHUD Shell.cmd` filename remains a compatibility alias for the plain shell; quote its path when invoking it from PowerShell.

Use the product CLI directly:

```powershell
node C:\path\to\Indro\packages\indro\cli.mjs state --json
node C:\path\to\Indro\packages\indro\cli.mjs search currentState tools
```

To make `hud` available globally, run this once from the product clone:

```powershell
npm install --global C:\path\to\Indro
```

Then every Git checkout has the same canonical access point:

```powershell
indro shell
indro tui
indro desktop
indro state --json
indro search currentState tools
```

`indro` is canonical and `i` is its short form. `hud` and `commandhud` remain compatibility aliases for the integrated execution/evidence subsystem.

## Project identity

A Git root is the minimum verified boundary. CommandHUD derives identity from, in order:

1. `commandhud.project.json`
2. `.commandhud/project.json`
3. the legacy-compatible `distribution/project.json`
4. the Git `origin` URL
5. the local repository directory name

An explicit configuration only needs an ID:

```json
{
  "id": "owner/project",
  "name": "Project name"
}
```

Projects may expose additional typed commands without changing CommandHUD:

```json
{
  "id": "owner/project",
  "commandHud": {
    "commands": [
      {
        "name": "verify-assets",
        "command": "python tools/verify_assets.py",
        "argv": ["python", "tools/verify_assets.py"],
        "owner": "tools/verify_assets.py",
        "resultMarkers": true,
        "successMarkers": [
          {"contains": "ASSETS=PASS", "summary": "assets verified"}
        ]
      }
    ]
  }
}
```

The browser requests the stable `name`; the runtime rereads the repository declaration, validates its owner path, and executes the recorded `argv`. It does not accept browser-supplied shell text. Optional `kind` values (`test`, `audit`, or `smoke`) select a generic reducer. Literal success markers add project-owned factual summaries only after exit 0. `resultMarkers: true` records strict `NAME=PASS|FAIL key=value` lines with their stream and line number; these facts never override the real process exit status.

Composite verification commands may optionally declare one `stageMarker` plus literal repository file/directory scopes in `stages`. CommandHUD records that model with the run. `hud impact <name>` can then compare retained passing stage evidence with current changed paths without rerunning the command. Undeclared or changed dependency models remain unknown; impact never skips verification or synthesizes PASS.

CommandHUD refuses execution outside a Git repository unless an explicit `--root` selects one.

## Verification

```powershell
npm test
git diff --check
```

The DATA game was the integration fixture where the current runtime matured. DATA-specific build and device commands remain owned by DATA and are discovered from its files and package scripts; the general CommandHUD runtime now lives here.

Read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for boundaries and `packages/commandhud/README.md` for the complete command reference.
