# Authority map

| Layer | Canonical responsibility | Must not own |
| --- | --- | --- |
| DigitalBreakdown Terminal | Interactive PTY lifecycle, raw input/output transport, resize, xterm ANSI/VT presentation, cursor/selection/copy compatibility | Command success, Git truth, agent lifecycle, proof, durable workflow history |
| CommandHUD in `Indro` | Verified repository identity, immutable operation/run identity, process execution it explicitly launches, raw stdout/stderr, Git snapshots, reductions, history, evidence retrieval, typed remote operations, undo planning | Terminal parsing/presentation; Brokeman continuity semantics; Indro language meaning |
| Indro | Grammar, typed intent/parameters, semantic IR, inferred/declared effects, effect authorization, deterministic plan IDs, proof planning and reuse eligibility | Process execution/evidence, terminal rendering, provider lifecycle |
| Brokeman | Read-only source adapters; durable checkpoint/semantic/provider/handoff/portable continuity projections | Repository truth, arbitrary execution, raw-evidence authority, automatic provider dispatch |
| Visual observation bridge | Normalize already-observed events; keep unknowns null; preserve source identities; distinguish replay | Inferring exit/success/verification from visible output |
| Buoyant/glyph renderer | Presentation-only response to observed events; reduced-motion and instant fallback | Terminal cells, cursor, selection, input, evidence claims |
| MonumentWorld | Optional spatial renderer consuming shared normalized identities | A second shell or independent command/event authority |

## Current terminal boundaries

`public/client.js` sends only `{type:"input",data}` and validated resize messages. `server.cjs` creates one `pwsh.exe -NoLogo` ConPTY per accepted same-origin WebSocket, forwards PTY bytes unchanged, resizes it, kills it on socket close, and closes the socket on shell exit. xterm remains the parser and cell model.

The first new bridge is deliberately client-local. It observes input kind/length, PTY output length, resize, and transport connection state. It retains no typed command content, asserts no command lifecycle, persists nothing, and cannot execute.

## Duplicate implementation comparison

| Candidate | Disposition |
| --- | --- |
| `Indro@52ea174` | Canonical local CommandHUD/Indro source examined. |
| `hate.this.meaningless.life@b96e249` | Historical ancestor. Reuse only via Git archaeology; do not merge wholesale. |
| `hate.this.meaningless.life-pr2` | Historical VS Code/DataFactory lineage with dirty user work. Preserve. |
| Legacy Windows Forms HUD | Interaction contract source only; runtime retired. |
| MonumentWorld character JSONL | Historical spatial-text authority for its own prototype; not suitable as terminal command history. |

Adapter boundary: future terminal integrations should call stable, read-only CommandHUD/Brokeman projections and map returned identities into observation events. No package source is copied into this repository.

## Reused implementation boundaries

The terminal now uses a bounded read-only adapter over CommandHUD's `verifyRoot`, `repositoryCurrency`, and `operationHistory` interfaces. It has no mutation route and exposes no command, agent, undo, filesystem, raw-evidence, or provider action. The panel projects operation state rather than importing CommandHUD storage or reimplementing it.

MonumentWorld contributes the separation rule—source state and optional views remain distinct. Jelly Terminal contributes only its bounded damped-response grammar; its `pyte` parser, `winpty` backend, and custom renderer are deliberately excluded because xterm/node-pty own those roles here.
