# Native CTest verification (experimental)

Run through the canonical INDRO CLI after configuring the native CMake build:

```powershell
indro verify-native --root "$HOME\Projects\data-game" --build "$HOME\Projects\data-game\build" --store "$HOME\indro-evidence\data-game" --configuration Release
```

This **builds first**, then executes the real CTest suite and records an append-only JSON receipt outside the repository. It does not reset, stash, clean, or rewrite source files. The receipt includes CTest output, exit status, durations, source and executable hashes, CMake cache, compiler paths/hashes where discoverable, test plan, and selected environment values. If a required fingerprint is unavailable, tests still run but the result is not reusable.

**Reuse is disabled by default.** `--declare-runtime-closure` explicitly asserts that the caller has accounted for *all* relevant runtime dependencies; repeat runs may then skip CTest if the recorded successful receipt, source/build/test executable fingerprints, and declared runtime files still match. Supply additional dependencies with repeated `--runtime-file PATH` arguments. The flag is a trust assertion, not automatic runtime dependency discovery. Do not enable it for `data-game` until its DLLs, data files, environment, and other runtime inputs are audited. A checksum detects accidental receipt changes but does not authenticate evidence against an attacker with write access.

The JSON result also includes `reuseDecision` and `changedInputs` (input category names, not fingerprint values). These distinguish unchanged evidence from missing/corrupt receipts, incomplete provenance, undeclared runtime closure, and changed inputs; in particular, `changedInputs: ["executables"]` identifies a Windows no-op build that changed binary bytes. A failed test still returns `FAILED` and a non-reusable receipt. These diagnostics describe the decision, not a proof of dependency completeness.

A no-op `cmake --build` still runs before every reuse decision. Thus `REUSED` means **CTest was skipped**, not that no build-related commands executed. A changed source, binary, build cache, compiler, test plan, declared runtime file, or corrupt newest receipt forces execution. A failing CTest or changing inputs produces no reusable success. This proof covers only the declared CMake/CTest dependency boundary; it is not a universal correctness certificate.

Test the adapter with `node --test packages/indro/native-verify.test.mjs`. These tests create a disposable CMake/C++/CTest fixture and cover execution, reuse, invalidation, failure, and provenance. They are **not** the 57-test Digital Breakdown suite. Measure game speedup only after a real Windows run against the existing 11.60-second CTest baseline, including the no-op build and fingerprint overhead.
