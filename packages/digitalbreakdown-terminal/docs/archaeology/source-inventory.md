# Source inventory

Inspected 2026-10-18. A dirty count is evidence to preserve, not a defect to repair.

| Source | State observed | Relevant material / disposition |
| --- | --- | --- |
| `DigitalBreakdown-Terminal` | Git `main`, clean baseline `f269c1c` | Two commits; xterm 6, FitAddon, Node WebSocket, node-pty ConPTY, Grid V3 font. Designated active implementation. |
| `DigitalBreakdown-Font` | Git `main` `5f5529c`; dirty/untracked files preserved | Working Jelly Terminal commit plus newer local font/backend work. Historical prototype only. |
| `DigitalBreakdown-MonumentWorld` | Git branch `experiment/solid-monuments-v4`, HEAD `8f43e0c`; `terminal/viewer.py` dirty | Seven-commit lineage: append-only world, WebGL extrusion, local/ANSI views, drone v3. Read-only evidence. |
| MonumentWorld `drone-v3`, `improved`, `perspective-v2` directories | Present, non-Git | Variant viewers/tests and JSONL events. Read-only prototype snapshots. |
| `Indro` | Git `main` `52ea174`, tracked and untracked local changes preserved | Newest local canonical CommandHUD/Indro history; 20 commits ahead of the `hate...` merge base. |
| `hate.this.meaningless.life` | Git `convergence/local-commandhud-20260912-075427`, `b96e249`, clean | Historical predecessor and merge base of current Indro. Core and CLI older; shell and Indro compiler files sampled identical. |
| `hate.this.meaningless.life-pr2` | Git branch, dirty files preserved | Older VS Code/DataFactory prototype lineage. No integration copied. |
| `Brokeman/brokeman-suite` | Present, no root `.git` | Architecture, adapter contract, checkpoint/provider/handoff/semantic/artifact contracts and tests. |
| `D:\hud` | Present | Brokeman runs, checkpoints, provider histories, handoffs, conversations, and historical Indro worktrees. Sampled structurally; not bulk-copied. |
| `data-game` | Git `main` `18b1980`, clean | Current gameplay authority and Big Bang branches/evidence lineage; not modified. |
| `DigitalBreakdown-Godot-Migration` | Git `main` `94ab70f`, heavily dirty | Related migration/evidence; preserved and not modified. |
| `bigbang-codex-handoff` | Present, non-Git | 2026-10-15/16 master handoff, thematic recap, digest, logs/evidence. Explicitly not a complete historical Git export. |
| `DataFactory` | Present, non-Git | Prototype lead; behavior accounted for by retirement audit. |
| `Continuum` | Git `main` `a16e8ad`, staged file preserved | Related compact-computation experiment; no terminal authority. |
| Codex sessions | `C:\Users\indro\.codex\sessions`, `archived_sessions` | Concept search found current session and one 2026-10-15 Big Bang session; archived match count zero. Authentication/config stores were not read. |
| Local OpenAI export | `C:\Users\indro\Downloads\OpenAI-export.zip` | Two ChatGPT conversation ZIP parts. Read only the structured conversation JSON into a temporary extraction: 150 conversations / 26,808 messages, 2025-11-22 through 2026-08-12. Source archive preserved. |
| Google Drive | Connected Drive metadata/content search | Exact and synonymous searches for the missing concepts found related archaeology docs and `Indie JS Game Structure Research`, but no separate ChatGPT export and no exact Rolling Clipboard, Jelly Terminal, Buoyant Canvas, Monument Typewriter, or autocomplete-mitosis source. No Drive files changed. |
| Codex attachments | Searched by concept only | No Rolling Clipboard hit. |

## Git lineage findings

- `hate.this.meaningless.life@b96e249` is the merge base and ancestor of `Indro@52ea174`; Indro is the safe canonical successor.
- Sample hashes show `shell.mjs`, `shell-builtins.mjs`, `indro_lang.py`, and `indro_proof.py` identical between those checkouts; `core.mjs` and `cli.mjs` differ because Indro continued.
- MonumentWorld’s authoritative state model is suitable as design evidence, not as a store to import: it records characters, while the terminal must retain xterm/PTY authority.
- Indro’s four summarized laws entered the current Git history in commit `460c4b5` on 2026-09-16. The exact fourth law is “Evidence is ambient,” with CommandHUD owning rich terminal evidence and Indro recording intent, plan, and linkage.

## Unavailable or deliberately excluded

- The located ChatGPT export stops on 2026-08-12; later conversations or another newer export were not available in the inspected local archive or Drive search.
- Remote-only branches, unreachable objects, deleted external media, and other machines were not available.
- Credential stores, private keys, browser history, authentication databases, and unrelated personal folders were not inspected.
- Screenshots/recordings were searched only where named project evidence exposed them; no broad personal-media crawl was performed.
