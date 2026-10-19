# Verification record

Date: 2026-10-19 (America/Chicago).

| Category | Evidence | Result |
| --- | --- | --- |
| SOURCE INSPECTED | Terminal source/manifests/Git; CommandHUD/Indro core, architecture, retirement audit; Brokeman contracts; Jelly code; MonumentWorld code/history; Big Bang handoff; named archives and Codex concept search | Passed for available local sources; scope/limitations in `source-inventory.md` |
| ARCHIVE SEARCHED | Local OpenAI export: 150 conversations / 26,808 messages through 2026-08-12; connected Google Drive exact and synonymous searches; Indro Git provenance | Recovered three direct user statements and the exact Indro laws; later named concepts remain unrecovered |
| STATIC CHECK PASSED | ES modules loaded by Node test runner; package test command | Passed |
| UNIT TEST PASSED | `npm test`: observation identity/nulls, input classification, clipboard projections, bounded CommandHUD adapter utilities, deterministic field, replay suppression, particle endpoint morph, functional/visual failure boundary, ConPTY environment, terminal-native evidence projection | 20/20 |
| INTEGRATION TEST PASSED | `npm test`: actual server on isolated ephemeral port, CommandHUD read-only endpoint, WebSocket, node-pty ConPTY, PowerShell | 1/1 |
| PTY BEHAVIOR VERIFIED | 120x35 resize, `TERM=xterm-256color`, terminal-native `dbt-evidence` function, Tab completing `Write-Outp`, repeated Backspace edit, Up history replay, Unicode alpha, Ctrl+C, post-interrupt command | Passed in automated integration test |
| GRAPHICAL RUNTIME LAUNCHED | Existing loopback server opened in in-app browser | Passed |
| TERMINAL-ONLY FALLBACK VERIFIED | `?visuals=off` disabled optional visual imports; browser submitted `Write-Output VISUALS_OFF_OK` to the real PTY | Passed; output observed as `VISUALS_OFF_OK` |
| FRAME CAPTURED | Browser-tool screenshot of 1280x720 terminal | Captured in tool session; not persisted as a repository file |
| VISUAL OUTPUT INSPECTED | Header, Grid V3 glyphs, live prompt/cursor, xterm viewport, translucent bottom field | Passed for static frame |
| COPY DOCK INSPECTED | Live xterm selection enabled Raw/Fenced actions and displayed `34 CH SELECTED`; Fenced reported copied; explicit Paste reported its length and did not submit | Passed in in-app browser; OS clipboard byte round-trip UNVERIFIED because the automation clipboard is isolated |
| VISUAL PARITY VERIFIED | Comparison against historical Jelly/MonumentWorld target | UNVERIFIED |

Command: `npm test` — 20 tests passed, 0 failed. The functional-boundary test deliberately throws from observation/animation after a simulated PTY write and verifies the write remains completed. The `dbt-evidence list 1` runtime command read a retained CommandHUD operation through the same read-only adapter as the browser panel.

Browser inspection reported no warning/error console entries. Read-only DOM inspection measured both canvas and terminal at 1280x672 CSS content extent, with the canvas at z-index 0 and `pointer-events: none`; reduced motion was false for this capture.

An already-running `node.exe server.cjs` owned loopback port 8765. It was identified and left untouched. The integration test was changed to reserve an ephemeral loopback port and pass it through `DB_TERMINAL_PORT`; production still defaults to 8765.

## Limitations

- The visual screenshot shows the field layer at rest, not a frame-by-frame wave propagation proof.
- Clipboard selection/copy and interactive full-screen programs were not graphically exercised in this turn.
- Shell exit/reconnect UI behavior was source-inspected but not included in the automated test.
- No performance trace or frame-time benchmark was recorded.
- The CommandHUD overview and bounded `head`/`tail` evidence expansion are live and read-only. Indro plan projection and Brokeman projection are not implemented.
- `?visuals=off` disables optional buoyant and semantic-morph imports. The terminal/xterm/PTY path remains available; a browser-level reduced-motion/disabled-visual runtime capture remains unverified.
- The server repairs only inherited missing/`dumb` TERM to `xterm-256color`, matching the node-pty terminal name; explicit non-dumb or `DB_TERMINAL_TERM` values are preserved. The prior Starship `TERM=dumb` failure is resolved in the tested ConPTY session.
- Copy projection unit tests verify exact raw bytes and safe Markdown fencing. The live browser verified selection/status/focus behavior, but an independent system-clipboard readback was unavailable from its isolated automation clipboard.
