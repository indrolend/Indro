# Remaining work

## Unresolved archaeology

- Locate a post-2026-08-12 ChatGPT export, if one exists, for the still-unrecovered Rolling Clipboard name, original buoyant/jelly/typewriter wording, and the transition from the general mitosis metaphor to autocomplete branching.
- Determine the human/assistant authorship of the Indro laws if an originating September transcript becomes available; Git establishes implementation provenance but not conversational authorship.
- Inspect exact legacy Windows Forms source from commit `86deeb4` only when a missing interaction contract requires it.
- Run the current Indro/CommandHUD and Brokeman suites in their own clean/authorized environments before claiming runtime currency; their working trees were intentionally not changed here.

## Engineering queue

1. Add an explicit in-UI visual toggle and runtime reduced-motion toggle in addition to OS preference and the current `?visuals=off` terminal-only path.
2. Measure animation frame time, xterm input latency, selection, clipboard, IME/Unicode width, and full-screen program compatibility.
4. Add server-side session/PTY lifecycle observations without inferring command lifecycle.
5. Prototype glyph animation only through a documented xterm renderer/addon seam; preserve an instant fallback.
6. Add explicit compact, expanded, structured, and handoff copy modes for retained evidence; bounded evidence expansion is implemented and the terminal exposes the canonical `hud` CLI fallback.
7. Map Indro plans and Brokeman checkpoints through adapters.
8. Reuse MonumentWorld schema/geometry lessons for an optional viewer; do not import its state store or shell.

## Acceptance gaps

Held Backspace was represented by repeated delete bytes in the PTY integration test; OS key-repeat timing itself was not measured. Interactive programs, clipboard selection, shell exit/recovery, deterministic browser capture, reduced-motion browser emulation, and sustained frame performance remain unverified.

## Functional/visual independence contract

Every future terminal integration must provide a required functional/text path before adding a visual projection. Optional visual modules are dynamically loaded after xterm initialization and may be disabled with `?visuals=off`. Observation and animation failures are caught after the relevant terminal I/O or evidence rendering action; they cannot throw through the PTY/WebSocket/xterm path. Evidence currency remains distinct from verification: the current browser projection labels all retained operations `unverified` until an authority supplies a distinct verification result.

The terminal defines `hud` only when an installed `hud` command is absent, forwarding to the canonical CommandHUD CLI. This is the baseline text path that future visual evidence features must preserve. See `docs/UNIFIED_PRODUCT_ENTRYPOINTS.md` for the product-level contract.
