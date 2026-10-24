# Universal Application Interface — P1 kernel

Initial transaction primitive for the INDRO UAI/NDRA SRS v0.1.

Run: `node --test packages/indro/uai/transaction.test.mjs`

This is an offline kernel, not a Windows application adapter. It records distinct evidence milestones, before/after observations, operation IDs, and a digest. Unknown acknowledgments remain unknown. Readback comparison is strict; adapters must normalize native quantization/tolerances under an explicit observation contract before treating a mismatch as confirmation.

Not implemented: persisted immutable evidence, adapter discovery, permissions enforcement, real FL Studio transport, independent effects, NDRA proofs, CLI routing, retries, or multi-application workflows.

Next: integrate this primitive into canonical `indro app` and CommandHUD evidence, then prove a live FL Studio parameter round trip.
