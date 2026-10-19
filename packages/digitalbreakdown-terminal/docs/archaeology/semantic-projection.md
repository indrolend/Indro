# Semantic projection contract

One authoritative source object may have several representations, all carrying the same `sourceSystem` and `sourceRecordIdentity`.

| Mode | Contract |
| --- | --- |
| Glyph | Short symbol/abbreviation; never the sole retained representation. |
| Summary | Human-readable observed state and consequences, with unknowns explicit. |
| Evidence | Provenance, evidence references, verification state, relationships, truncation limits. |
| Raw | Exact retained source bytes/record only when the authority says they exist. |
| Structured | Versioned machine-readable projection preserving identity and null unknowns. |
| Handoff | Authority-produced or source-backed continuation packet, never a UI reconstruction presented as canonical. |

## Normalized observation v0

Implemented fields: `eventIdentity`, `sourceSystem`, `sourceRecordIdentity`, `timestamp`, `sessionIdentity`, `operationIdentity`, `eventType`, `observedState`, `evidenceReference`, `verificationStatus`, `relatedObjects`, `historicalReplay`.

Rules:

1. Null means unknown/unavailable; it must not be synthesized.
2. `terminal.output` is not a process exit, observed state, verified result, or visual inspection.
3. Replayed history keeps its original identity and sets `historicalReplay`; it cannot create live-execution animation/evidence.
4. Copy is explicit and never executes paste. “Raw” is disabled or labeled unavailable if the source is reduced/truncated.
5. The terminal’s current observation stream retains input classification and length, not command text.

## Rolling Clipboard disposition

No original design was recovered. The safe synthesis is a stateless recent-object view over authoritative identities, using CommandHUD evidence/handoff builders and explicit browser clipboard actions. It must not create another immutable history store. Implementation is deferred until a read-only CommandHUD adapter is present.

## Implemented compact-to-evidence slice

The CommandHUD adapter now exposes an explicit retained-evidence expansion endpoint for a validated `runId`. It accepts only `head` or `tail`, clamps the requested line count, and returns stream name, total line count, truncation status, and the projected lines. It deliberately does not return command text, raw evidence paths, a full raw mode, or an execution action. The browser preserves `runId` through the expansion observation and labels historical evidence as replay. This gives the compact label, its visual transformation, and its detail panel one source identity without creating a second evidence store.
