# Results after repair

## Verdict

**PASS — CONTINUE.** Signed evidence reuse retained all 57 tests' coverage, rejected every controlled mutation and receipt attack, survived process restart, and reduced unchanged verification from a pooled ordinary median of 15.91 seconds to 1.12 seconds (14.24×).

## Performance

All values are end-to-end wall-clock measurements in milliseconds. Conditions A through E use five interleaved repetitions from session `20261026-064001`. The optimized fresh path was then measured five times in session `20261026-065438`.

| Condition | n | Median | Min | Max | Result |
|---|---:|---:|---:|---:|---|
| A ordinary build + full CTest | 5 | 15893.39 | 15794.42 | 21232.55 | 57/57 |
| B signed INDRO fresh, initial implementation | 5 | 18977.53 | 18927.69 | 19183.98 | EXECUTED, 57/57 |
| B-fixed signed INDRO fresh, current implementation | 5 | 18525.94 | 18427.13 | 19568.94 | EXECUTED, 57/57 |
| C signed INDRO unchanged reuse | 5 | 1117.49 | 1087.27 | 1159.52 | REUSED, buildMs 0 |
| D ordinary unchanged repetition | 5 | 15913.46 | 15822.98 | 15983.97 | 57/57 |
| E signed INDRO reuse after process exit | 5 | 1113.08 | 1106.38 | 1122.67 | REUSED, buildMs 0 |

The pooled ordinary median is 15908.80 ms. Relative to it, C is **14.24×** faster and E is **14.29×** faster. The current fresh-verification median is slightly faster than the pre-repair INDRO median of 18539.40 ms, so the repair introduced no first-run regression relative to the production verifier it replaced. One reuse recovers the initial overhead.

The measured saving comes from signed evidence reuse avoiding both the roughly four-second no-op Visual Studio build and the roughly 11.9-second CTest run. Snapshot, tool, signature, and signed-head validation account for the remaining approximately 1.1 seconds. CMake still remains authoritative on every miss.

## Invalidation and integrity

The signed real-workload run produced zero false reuse:

| Mutation | Observed |
|---|---|
| No relevant change | REUSED / CURRENT |
| Relevant source forced to fail | FAILED / INPUT_CHANGED; failing test executed |
| Test executable byte changed | EXECUTED / INPUT_CHANGED |
| CMake cache/generated instruction changed | EXECUTED / INPUT_CHANGED |
| Declared runtime dependency changed | EXECUTED / INPUT_CHANGED |
| Newest receipt overwritten/corrupted | EXECUTED / RECEIPT_HEAD_INVALID |
| Evidence store absent | EXECUTED / NO_RECEIPT |
| Test registration changed with count still 57 | EXECUTED / INPUT_CHANGED |
| Unrelated untracked file added | EXECUTED / INPUT_CHANGED |
| Receipt modified and checksum recomputed | EXECUTED / RECEIPT_HEAD_INVALID |
| Newest receipt deleted to expose older success | EXECUTED / RECEIPT_HEAD_INVALID |

Unsigned operation remains CLI-compatible but is deliberately non-reusable (`SIGNING_KEY_UNDECLARED`). Receipts use Ed25519 signatures and a signed head outside the receipt store, namespaced by store identity. A receipt-store writer can no longer forge or roll back evidence. The private key and adjacent head namespace are explicitly trusted INDRO authority.

## Architectural attribution

- The measured benefit comes from `packages/indro/native-verify.mjs`: it validates a signed exact snapshot and returns before CMake/CTest.
- CommandHUD's generic execution/history runtime still does not participate in this cache decision.
- NDRA contributed no behavioral-equivalence substitution; `NdraResidueExperiment` remains one of the 57 normally verified tests.
- Continuum made no measured contribution.
- CMake/CTest remain authoritative on every miss; INDRO adds authenticated reuse rather than relabeling their incremental cache.

## Remaining limitations

- Windows system DLL contents remain an explicit trusted ambient assumption rather than individually hashed runtime files.
- Timings cover one Windows machine, Release configuration, and five repetitions per condition.
- Unrelated repository files conservatively invalidate reuse.
- Anyone controlling the private key/head authority can create evidence; protect that location with operating-system access controls or a hardware-backed key if the threat model includes compromise of the INDRO account itself.

## Recommendation

**CONTINUE.** The repaired verifier now demonstrates a large, reproducible real-workload advantage with fail-closed invalidation and authenticated evidence under an explicit local trust boundary.
