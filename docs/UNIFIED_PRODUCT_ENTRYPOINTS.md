# Unified product entry points

Indro is one local-first development product. Its presentations are interchangeable clients over shared authority; they are not separate products with copied runtimes.

## Required entry points

| Entry point | Role | Authority |
| --- | --- | --- |
| `hud` | Canonical CLI for operational work, immutable evidence, retained output, typed commands, proof, impact, and agent lifecycle | CommandHUD core |
| `indro` / `i` | Canonical CLI for intent, plans, effects, abbreviations, and proof relationships | Indro compiler/runtime |
| Graphic terminal | Primary interactive presentation: real shell plus optional projections of CLI-compatible state | xterm/ConPTY for shell; source systems for projections |
| `brokeman` | Durable continuity, checkpoint, provider, and handoff commands | Brokeman continuity layer |

The graphical terminal replaces the fixed CommandHUD TUI as the intended rich interactive presentation. `hud shell` remains a functional line-oriented compatibility surface until the terminal launcher and CLI migration are complete.

## Capability contract

Every capability must have this order:

```text
source authority
  -> CLI/text command (required)
  -> structured projection (when available)
  -> graphic-terminal representation (optional)
```

The graphic terminal may never create a second executor, run history, plan compiler, proof store, or provider lifecycle. It can launch or stage canonical commands, read source-backed projections, and present their identities visually.

## Current terminal behavior

The terminal session defines a `hud` PowerShell function only when no installed `hud` command is already present. The fallback invokes `packages/commandhud/cli.mjs`, so `hud history`, `hud tail`, `hud proof`, and other existing CLI commands remain available inside the graphic terminal without a parallel `dbt-*` command family.

The server's read-only evidence panel remains an adapter over the same CommandHUD core. It is a graphical projection, not a separate capability.

## Platform shell transport

The graphic terminal uses PowerShell 7 (`pwsh`) on every supported host. On Windows it starts `pwsh.exe` through ConPTY; on macOS and Linux it starts `pwsh` through the native PTY path. This is transport selection only: the CLI/core authority and terminal command contract stay identical. A host must have PowerShell 7 available on `PATH`; the server fails visibly if it is unavailable.

## Migration rule

New terminal features start by extending the owning CLI/core contract. The terminal then consumes that source identity and structured output. A terminal-only feature is permitted only for shell presentation mechanics that have no independent operational meaning, such as cell alignment, glyph motion, field damping, or selection affordances.
