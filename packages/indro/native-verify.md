# Native CTest verification (experimental)

Run through the canonical INDRO CLI after configuring the native CMake build:

```powershell
indro verify-native --root "$HOME\Projects\data-game" --build "$HOME\Projects\data-game\build" --store "$HOME\indro-evidence\data-game" --configuration Release --evidence-key "$HOME\indro-keys\native-ed25519.pem" --declare-runtime-closure
```

This **builds first**, then executes the real CTest suite and records an append-only JSON receipt outside the repository. It does not reset, stash, clean, or rewrite source files. The receipt includes CTest output, exit status, durations, source and executable hashes, CMake cache, compiler paths/hashes where discoverable, test plan, and selected environment values. If a required fingerprint is unavailable, tests still run but the result is not reusable.

**Reuse is disabled by default.** `--declare-runtime-closure` explicitly asserts that the caller has accounted for *all* relevant runtime dependencies, while `--evidence-key` names an existing Ed25519 PKCS#8 private key outside both the source and evidence store. Repeat runs may skip both CMake build and CTest only when the signed receipt, separately anchored signed head, source/build/test executable fingerprints, and declared runtime files all match. Supply additional dependencies with repeated `--runtime-file PATH` arguments. The closure flag is a trust assertion, not automatic runtime dependency discovery. Protect the key and adjacent `.head.json` as INDRO authority; a writer who controls them as well as the receipt store remains inside the trust boundary.

The JSON result also includes `reuseDecision` and `changedInputs` (input category names, not fingerprint values). These distinguish unchanged evidence from missing/corrupt receipts, incomplete provenance, undeclared runtime closure, and changed inputs; in particular, `changedInputs: ["executables"]` identifies a Windows no-op build that changed binary bytes. A failed test still returns `FAILED` and a non-reusable receipt. These diagnostics describe the decision, not a proof of dependency completeness.

INDRO snapshots before building. An authenticated exact match returns `REUSED` without launching `cmake --build` or the full CTest suite. Any changed source, binary, build cache, compiler, test plan, declared runtime file, missing key/head, broken signature, rollback, or corrupt newest receipt falls through to the authoritative build and CTest execution. A failing CTest or changing inputs produces no reusable success. This proof covers only the declared CMake/CTest dependency boundary; it is not a universal correctness certificate.

Test the adapter with `node --test packages/indro/native-verify.test.mjs`. These tests create a disposable CMake/C++/CTest fixture and cover execution, reuse, invalidation, failure, and provenance. They are **not** the 57-test Digital Breakdown suite. Measure game speedup only after a real Windows run against the existing 11.60-second CTest baseline, including the no-op build and fingerprint overhead.
