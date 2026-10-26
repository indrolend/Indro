# Results

## Verdict

**FAIL — RETHINK.** INDRO correctly avoided CTest and rejected every ordinary controlled input mutation, but it missed the 3× target (2.88×) and, more importantly, its receipt checksum did not provide immutability: a modified and rehashed receipt was accepted as `REUSED/CURRENT`.

## Performance

All values are end-to-end wall-clock measurements in milliseconds. Variability is sample standard deviation.

| Condition | n | Median | Min | Max | Std. dev. | Result |
|---|---:|---:|---:|---:|---:|---|
| A ordinary build + full CTest | 5 | 16052.06 | 16036.64 | 16081.99 | 20.41 | 57/57 |
| B INDRO fresh verification | 5 | 18539.40 | 18431.70 | 18870.07 | 177.42 | EXECUTED, 57/57 |
| C INDRO unchanged reuse | 5 | 5576.52 | 5532.72 | 5613.98 | 34.26 | REUSED |
| D ordinary unchanged repetition | 5 | 16034.21 | 15976.60 | 16090.47 | 43.59 | 57/57 |
| E INDRO reuse after prior process exit | 5 | 5592.52 | 5566.24 | 5664.94 | 38.78 | REUSED |

The pooled ordinary median is 16048.28 ms. Relative to it, C is **2.88×** faster and E is **2.87×** faster. Fresh INDRO is 15.5% slower than ordinary verification. Its one-time overhead is recovered after one successful reuse: `(18539.40 + 5576.52) < 2 × 16048.28`. This break-even excludes the pre-existing game build/configuration cost but includes evidence initialization in B.

The observed saving comes from skipping approximately 11.82 seconds of CTest execution. It does not avoid compilation: every INDRO hit still invokes `cmake --build`. The remaining roughly 5.58 seconds is mostly the no-op Visual Studio build plus full source/executable/tool/environment fingerprinting. This is evidence reuse beyond CMake/CTest caching, but it is not a 3× end-to-end win.

## Invalidation

No ordinary controlled mutation produced false reuse:

| Mutation | Observed |
|---|---|
| No relevant change | REUSED / CURRENT |
| Relevant source forced to fail | FAILED / INPUT_CHANGED; failing test was executed |
| Test executable byte changed | EXECUTED / INPUT_CHANGED |
| CMake cache/generated build instruction changed | EXECUTED / INPUT_CHANGED |
| Declared runtime dependency changed | EXECUTED / INPUT_CHANGED |
| Newest receipt accidentally corrupted | EXECUTED / RECEIPT_CORRUPT |
| Evidence store absent | EXECUTED / NO_RECEIPT |
| Test registration changed with count still 57 | EXECUTED / INPUT_CHANGED |
| Unrelated untracked file added | EXECUTED / INPUT_CHANGED |

The unrelated-file result is conservative rather than unsafe: reuse is lost because the verifier fingerprints every repository file. Full details and evidence IDs are in `invalidation.json`.

## Evidence integrity

Receipts bind the execution identity, test count, test plan, binaries, source, build cache, compiler/tools, environment, and declared runtime files. Hits remain reusable after process exit and are clearly reported as `REUSED`, not as newly executed tests. Missing and accidentally corrupted evidence fail closed.

However, the store is not immutable or authenticated. The audit overwrote a valid receipt's stdout, recomputed the public unkeyed SHA-256 field, and then received `REUSED/CURRENT` for the same receipt. Exclusive creation prevents filename collision during initial write; it does not prevent later rewriting. This fails the explicit evidence-immutability criterion.

## Architectural attribution

- The measurable benefit came from `packages/indro/native-verify.mjs` storing a successful CTest receipt and skipping CTest when its fingerprint matched.
- CommandHUD's generic execution/history runtime did not participate in the native verifier's cache decision or measured path; the CLI imports the native verifier directly.
- NDRA contributed no measured cache behavior. `NdraResidueExperiment` was one of the 57 ordinary CTest tests, but no behavioral-equivalence substitution occurred.
- Continuum contributed no observed reuse behavior in this experiment.
- CMake provided the no-op incremental build in both workflows. INDRO's additional benefit was only the avoided CTest run; it did not avoid the CMake/MSBuild startup.

## Limitations

- System DLL contents are an explicit trusted ambient assumption and are not hashed.
- Timings are one Windows machine, one Release build, and five interleaved repetitions per condition; they are not cross-platform claims.
- The active game checkout was dirty, so the benchmark identity is commit plus the exact dirty paths in `baseline.json`, not commit alone.
- The disposable invalidation fixture was clean commit `8e682427…`; it exercised the same 57-test registration but not the active checkout's dirty overlay.
- No claim is made that NDRA or Continuum caused a speedup.

## Recommendation

**RETHINK.** The core idea avoids real work and breaks even after one reuse, but the measured end-to-end gain misses the project target and the current evidence store cannot substantiate immutable history. Do not add architectural layers based on this result; first decide whether a simpler authenticated receipt/cache with less than about 5.35 seconds of hit overhead can meet the target.
