# Visual language

These mappings are design contracts, not evidence by themselves.

| Observed event | Visual response | Evidence rule |
| --- | --- | --- |
| `terminal.input` text | Local positive impulse; energy scales with observed input chunk length | Means only input bytes were accepted by the browser handler. |
| Backspace | Negative/directional impulse | Does not claim a character was deleted from shell state. |
| Completion request | Small branch-ready impulse | Candidate branches require an actual completion-source event; not implemented. |
| Ctrl+C | Strong negative impulse | Means interrupt bytes were sent, not that the process stopped. |
| PTY output | Low-amplitude field activity proportional to byte count | Never implies progress or success. |
| Retained CommandHUD operation | Read-only evidence object with status/integrity labels | Historical evidence is marked replay and creates no live activity impulse. |
| Resize | Geometry update without evidence color | Presentation fact only. |
| Process exit | Settle to an explicit terminal state | Requires future PTY exit observation. |
| CommandHUD verified result | Stable anchor/evidence mark | Requires CommandHUD verification state and source record identity. |
| Brokeman checkpoint | Durable anchor linked to job/checkpoint IDs | Requires retained checkpoint evidence. |
| Provider transition | Connection between checkpoint and providers | Requires history plus released-writer/authority evidence. |
| Evidence expansion | Compact object unfolds through a short particle morph into a bounded retained-evidence panel | Same `runId` persists; endpoint text and line bounds remain explicit. |

## Implemented bounded field

`BuoyantField` is a deterministic 1-D damped wave with localized three-sample impulses, neighbor curvature propagation, and reflected boundaries. A transparent canvas sits behind xterm. It cannot receive pointer events and never alters xterm cells. `prefers-reduced-motion` disables both display and excitation. Historical replay energy is exactly zero.

This is a readable experiment, not a completed two-way fluid/glyph simulation. There is no per-glyph renderer, occupied-cell reflection, pressure/volume UI, autocomplete mitosis, or evidence-state palette yet.

## Compact-to-evidence transformation

The first explicit transformation slice is intentionally narrow. Selecting `EXPAND` on a retained CommandHUD operation requests only a source-validated `head` or `tail` line projection. The compact operation label morphs through deterministic Braille-like particles toward the bounded line count, then the retained text panel appears. Reduced-motion users receive the same panel without animation. The transition is presentation-only: it does not rewrite xterm cells, invoke a command, infer process success, or treat the animation as verification.

Future completion visualization needs a real candidate/selection source. A Tab byte currently creates only a branch-ready field impulse. Starship, Codex, and Copilot menus cannot be made into a revolving selector until a provider supplies candidate identities and selected-index events; otherwise the terminal would be fabricating interface state.
