# Indro architecture

## Authority flow

```text
Indro source + typed parameters + effect authority + proof state
                         |
                         v
             packages/indro compiler/planner
          semantic IR / minimal proof plan / plan ID
                         |
                         v
        packages/commandhud execution/evidence core
        execution / evidence / reduction / state
                         |
             +-----------+-----------+
             |           |           |
            CLI       terminal UI   desktop UI
```

Indro owns language meaning and planning. CommandHUD owns execution and evidence. There is one runtime state and evidence model; frontends do not own independent execution histories.

## Repository boundary

CommandHUD verifies the selected directory through `git rev-parse --show-toplevel`. An optional project manifest supplies stable human identity and project-specific metadata. Without a manifest, the Git remote or root name supplies identity.

Local coding agents are replaceable workers behind CommandHUD's existing authority boundary. The first adapter names the installed Codex CLI as `codex/local`; a start request must carry the exact expected Git HEAD, and CommandHUD rejects mismatch before process launch. Typed starts create a detached Git worktree under CommandHUD's machine-local state root at that exact commit, so the worker never edits the authoritative checkout. The immutable run ID is the stable session/evidence identity while provider thread IDs remain non-authoritative metadata. Agent state is derived from the active typed operation or its final run record, not mirrored into another mutable store. The local SSE and cancellation primitives are reused. Public connectivity and authentication belong in a later narrow remote adapter, never in the desktop terminal surface.

Detached-agent listing scans those same run directories. Cancellation is a typed request placed inside the verified inflight run and consumed by the owning worker; remote callers never supply a PID. Workspace discard resolves the path from final immutable evidence, requires it to remain under CommandHUD's worktree root and registered to the verified source repository, and leaves the run evidence intact.

The repository-owned `commandhud-remote` plugin is a stdio MCP projection over this core, not another server authority. Its tools accept project and session identities, resolve roots locally from the reverified CommandHUD registry, and return bounded semantic state without local filesystem roots. A private tunnel or other authenticated transport may carry this protocol, but transport does not gain the desktop terminal capability.

Repository scripts and files remain the source of discovered commands. Package scripts are discovered mechanically; additional typed commands are declared under `commandHud.commands` in the selected project manifest. Commands may select generic test/audit/smoke reduction and declare literal success markers. Generic CommandHUD code does not copy DATA-specific commands or output markers into another authority.

## State boundary

Machine-local evidence lives outside project Git:

```text
Windows: %LOCALAPPDATA%\CommandHud
macOS:   ~/Library/Application Support/CommandHud
Linux:   $XDG_STATE_HOME/commandhud
```

Each record carries project identity, root, branch, commit, command, exit status, time, raw output paths, and repository currency. Shareable project configuration may live in `commandhud.project.json` or `.commandhud/project.json`; credentials and transient evidence never do.

## Current and historical material

| Path | Classification |
| --- | --- |
| `packages/indro/` | language, compiler, semantic IR, proof planning, benchmarks |
| `packages/commandhud/` | current product authority |
| `packages/commandhud/repository-map-client/` | current browser renderer; client only, not semantic authority |
| root `hud.cmd` | argument-preserving CLI front door |
| `CommandHUD.cmd` | Windows compatibility launcher for the complete CLI |
| `CommandHUD-TUI.cmd` and `CommandHUD-Desktop.cmd` | unambiguous Windows client launchers |
| `CommandHUD Shell.cmd` | quoted compatibility alias for the plain shell |
| `docs/PROTOTYPE-RETIREMENT-AUDIT.md` | behavioral accounting for removed prototype lineages |

Retired source remains available through Git history. Do not restore it to the active tree unless a demonstrated current contract cannot be implemented through the canonical runtime.
