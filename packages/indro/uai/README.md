# INDRO Universal Application Interface — P1

This branch implements a deliberately narrow, offline transaction kernel.

## Run

```powershell
node --test packages/indro/uai/transaction.test.mjs
node packages/indro/cli.mjs app help
node packages/indro/cli.mjs app fixture set 0.75 --json
npm test
```

The fixture changes in-memory state only. It does **not** contact FL Studio or another Windows program.

## Evidence semantics

Each transaction carries an operation ID, explicit unknown milestones, before/after observations, a verdict, and a checksum. A checksum does not imply persisted immutable evidence. The caller supplies expected state; an adapter cannot override it. Numeric comparison may use a caller-provided absolute tolerance. A timeout during invocation is `TRANSPORT_UNKNOWN` because delivery may have occurred.

## Remaining release gates

- Real adapter discovery, target/session scoping, and permission enforcement
- CommandHUD-backed append-only evidence
- Live FL Studio request/response and readback
- Independent effect verification
- NDRA observation contracts and reuse proofs
- Retry, cancellation, and recovery semantics

No claim of full SRS compliance is made.
