# Integration plan

| Slice | Dependencies | Acceptance criteria | Status |
| --- | --- | --- | --- |
| 0 Baseline | Existing checkout | Clean starting state recorded; real WebSocket/ConPTY exercises edit, completion, history, Unicode, resize, interrupt, recovery | Complete |
| 1 Archaeology | Named local evidence | Eight required documents; provenance/classes/limits explicit; no other repository modified | Complete for available local evidence |
| 2 Event observation | xterm/PTY boundaries | Narrow immutable events, null unknowns, identity/order tests, no command rewriting | Complete v0 |
| 3 Physical interaction | Slice 2 | Bounded deterministic field, live input/output impulses, reduced-motion, pointer/terminal isolation, visual launch | Complete experiment; glyph coupling pending |
| 3A Copy dock | Existing xterm selection/paste APIs | Exact/fenced copy, explicit non-executing paste, content-free observations, accessible status | Implemented; browser clipboard verification pending |
| 4 CommandHUD | Stable read-only public adapter | Repo/branch/HEAD/latest runs/evidence/verification shown without mutation or copied runtime | Implemented bounded overview; evidence expansion pending |
| 5 Reversible evidence | Slice 4 | Identity-preserving expand/copy modes; honest raw/truncation behavior | Pending |
| 6 Indro | Read-only plan records | Plans, effects, proof requirements/reuse shown; no compiler fork | Pending |
| 7 Brokeman | Source adapter | Jobs/checkpoints/providers/handoffs shown with evidence-qualified transitions | Pending |
| 8 MonumentWorld | Shared event identities | Optional renderer; live/replay distinction; terminal remains usable independently | Pending |
| 9 Remote | Authentication/read-only transport | No public localhost; typed read-only projection before controls | Pending |

## Primary risks

- xterm internals are not a stable per-glyph animation API; prefer a documented addon/custom renderer seam only after measurement.
- Shell-visible output cannot establish process/result semantics.
- CommandHUD local checkout is dirty; integrate through a public read-only interface rather than imports tied to that tree.
- Canvas compositing can reduce contrast; measure frame time and readability before increasing opacity/complexity.
- Historical prototype event stores must not be silently promoted into canonical terminal history.

## Slice 4 design

Add a server-side read-only adapter configured by an explicit CommandHUD root/project identity. It should call or import a documented current-state/history projection, return bounded structured records, and never accept shell commands, PIDs, filesystem paths, undo, agent launch, or repository mutation. Map records into the existing observation schema with CommandHUD run IDs as source identities.

Dogfooding and copy-first sequencing are specified in `dogfooding-plan.md`. Slice 4 should expose capability flags per source object so the copy dock can add semantic modes without guessing or reconstructing unavailable evidence.
