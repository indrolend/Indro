# Remaining work

## Unresolved archaeology

- Locate a post-2026-08-12 ChatGPT export, if one exists, for the still-unrecovered Rolling Clipboard name, original buoyant/jelly/typewriter wording, and the transition from the general mitosis metaphor to autocomplete branching.
- Determine the human/assistant authorship of the Indro laws if an originating September transcript becomes available; Git establishes implementation provenance but not conversational authorship.
- Inspect exact legacy Windows Forms source from commit `86deeb4` only when a missing interaction contract requires it.
- Run the current Indro/CommandHUD and Brokeman suites in their own clean/authorized environments before claiming runtime currency; their working trees were intentionally not changed here.

## Engineering queue

1. Implement Slice 4: a bounded read-only CommandHUD adapter and identity-preserving status objects.
2. Add an explicit overlay toggle and runtime reduced-motion toggle in addition to OS preference.
3. Measure animation frame time, xterm input latency, selection, clipboard, IME/Unicode width, and full-screen program compatibility.
4. Add server-side session/PTY lifecycle observations without inferring command lifecycle.
5. Prototype glyph animation only through a documented xterm renderer/addon seam; preserve an instant fallback.
6. Add reversible evidence expansion/copy modes after authoritative records exist.
7. Map Indro plans and Brokeman checkpoints through adapters.
8. Reuse MonumentWorld schema/geometry lessons for an optional viewer; do not import its state store or shell.

## Acceptance gaps

Held Backspace was represented by repeated delete bytes in the PTY integration test; OS key-repeat timing itself was not measured. Interactive programs, clipboard selection, shell exit/recovery, deterministic browser capture, reduced-motion browser emulation, and sustained frame performance remain unverified.
