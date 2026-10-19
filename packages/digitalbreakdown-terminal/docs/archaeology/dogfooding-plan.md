# Dogfooding plan

The terminal should be developed against real Digital Breakdown work, with ordinary xterm/PowerShell behavior remaining the control condition. Dogfooding evidence may record interaction shape, duration, counts, and explicit user notes; it must not silently retain command text, clipboard contents, secrets, or unrelated personal material.

## Recurrent work to support

Recent local development traces and the recovered transcripts show a repeated loop:

1. Orient: identify repository, branch, dirty state, task, and authoritative checkout.
2. Search: use `rg`, Git history, documentation, transcripts, and retained evidence to locate an idea or implementation.
3. Inspect: open bounded source regions and compare competing implementations.
4. Execute: run builds, tests, PTY probes, browsers, or a long-running process.
5. Extract: select the useful command, output fragment, path, commit, or evidence identity.
6. Transform: turn that selection into chat-ready text, structured evidence, a handoff, or a reusable compact reference.
7. Continue: move the information between terminal, Codex, editor, issue, provider, device, or later session without losing provenance.

The highest-friction boundary is not command execution itself. It is finding the exact useful region in mixed input/output, copying it into the right representation, and later knowing where it came from and whether it was complete.

## Instrumented questions

Dogfood sessions should answer these with aggregate or explicitly saved evidence:

| Question | Safe measurement |
| --- | --- |
| How often is terminal text selected and then reselected? | Selection count, length, elapsed time; no text |
| Which representation is needed? | Raw, fenced, structured, evidence, compact, handoff |
| What makes copied material unusable? | Explicit reason tag: prompt noise, wrapping, truncation, ANSI, missing provenance, too much context |
| Where does it go? | Explicit destination class: Codex, editor, issue, shell, device, archive |
| Was the paste meant to execute? | Paste and Enter remain separate observed actions |
| Can the source be reopened? | Source identity/evidence reference present or absent |
| Did visuals help? | Explicit user rating plus task time/error count; animation alone is not evidence |

## Copy-first interaction model

The first implementation is a selection-aware copy dock:

- **Copy Raw** preserves xterm's selected text exactly.
- **Copy Fenced** creates a Markdown-safe text block and chooses a fence longer than any backtick run in the selection.
- **Paste** is explicit and uses xterm's paste path. It never sends Enter automatically.
- The observation stream records mode and character count only.

Next representations arrive only with an authoritative source object:

- **Compact**: authority-produced abbreviation plus identity.
- **Expanded**: readable summary with unknowns and truncation visible.
- **Evidence**: retained output/provenance link, verification state, and source identity.
- **Structured**: versioned record suitable for another tool.
- **Handoff**: source-backed continuity packet, never reconstructed and mislabeled as canonical.

## Visual grammar for copying

Selection is a temporary membrane around terminal cells. Copy creates a small persistent echo that travels to the dock; the echo carries a representation shape, not a success claim. Pasting reverses the direction and deposits text at the cursor without execution. Repeated copies may appear as a short-lived rolling ribbon, but durable history remains owned by CommandHUD or the originating authority. Reduced motion replaces travel with a border/state change.

Input, output, selections, evidence, and verified state must be visually distinguishable. Color is secondary to shape and labels. No animation may imply that output is verified, complete, or successful.

## Vertical slices

1. **Copy dock:** raw/fenced copy, explicit paste, content-free observations, keyboard/accessibility verification.
2. **Selection diagnostics:** opt-in aggregate counters and explicit friction tags; no content logging.
3. **Read-only CommandHUD adapter:** repository/run/evidence identities and honest availability.
4. **Semantic copy lens:** enable compact/expanded/evidence/structured/handoff only per source capabilities.
5. **Rolling ribbon:** ephemeral recent projections backed by source identities; no second history store.
6. **Indro/Brokeman continuity:** plans, authorization boundaries, checkpoints, and handoffs become selectable objects.
7. **Spatial view:** optional MonumentWorld projection of the same identities and replay state.

## Acceptance criteria for the first slice

- Ordinary typing, editing, completion, history, ANSI, resize, interrupt, Unicode, selection, and interactive PTY traffic remain xterm-owned.
- Raw copy is exact; fenced copy is syntactically safe around embedded backticks.
- Paste is explicit and never executes automatically.
- Clipboard content is absent from observation records.
- Clipboard denial produces a visible status and does not disturb the terminal.
- Selection and clipboard controls are keyboard reachable.
- Browser runtime is visually inspected; clipboard permission behavior is reported separately from unit tests.
