# INDRO Universal Application Interface — P1

This branch implements a deliberately narrow, offline transaction kernel.

## Run

```powershell
node --test packages/indro/uai/transaction.test.mjs
node packages/indro/cli.mjs app help
node packages/indro/cli.mjs app fixture set 0.75 --json
node packages/indro/cli.mjs app process priority --spawn --set BelowNormal --json
npm test
```

The fixture changes in-memory state only. It does **not** contact FL Studio or another Windows program.

The Windows process command accepts only the exact form shown above. It creates and owns a disposable child, binds its PID to its creation time before every operation, sets priority through the experimental adapter, reads the value back, records a CIM observation as declared shared authority (not independent proof), confirms cleanup, and writes a create-only receipt beneath CommandHUD's machine-local state root.

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

## Bounded phenotype assay

`assay.mjs` compares two synchronous transition functions across explicitly
enumerated initial states and inputs. A caller-supplied projection defines the
observable phenotype. The first difference produces a counterexample; a finite
matching domain produces `PROVEN_EQUIVALENT` scoped to those enumerated cases.
Execution errors and bound overruns yield `UNKNOWN`.

This is not a DNA/RNA emulator, a source decompiler, a stateful sequence explorer,
or an NDRA proof of arbitrary future behavior. Projection/comparator identifiers
are not yet serialized into the contract hash; do not reuse these hashes as
independent proof certificates.

Run `node --test packages/indro/uai/*.test.mjs`.
