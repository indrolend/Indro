# INDRO definitive native verification experiment

## Scope and identity

This began as a falsification experiment against the real Digital Breakdown CMake/CTest workload and then verified the bounded repair requested after the original failure. The authoritative game source was never edited. The verifier baseline is INDRO commit `69ccad504fbfb2e3deac235c8a63d9f1ae805b81`; the repair is on the isolated experiment branch. The dirty game checkout remained at commit `8e6824278f1226f0d74950688d6cf7badb736d30`. Exact dirty paths, tool versions, build identity, and runtime assumptions are in `baseline.json`.

The independent preflight and performance benchmark used `C:\Users\indro\Projects\data-game\build`. Controlled mutations used detached worktree `D:\hud\fixtures\data-game-definitive-20261026` and build `D:\hud\builds\data-game-definitive-20261026`; they never touched the authoritative checkout. Receipt stores were under `D:\hud\experiments` because the verifier correctly rejects stores inside source repositories.

## Verification boundary

CTest registers 57 tests backed by 55 unique executables. All 57 passed before measurement. The direct imports of those executables are Windows system DLLs only. The benchmark explicitly declares runtime closure under a limited trust model: repository content, test executables, compiler/toolchain, CTest plan, CMake cache, environment, and any supplied runtime files are fingerprinted; installed Windows system DLL contents are trusted ambient platform state and are not hashed. This is an explicit limitation, not a universal runtime proof.

## Commands

Independent ordinary verification:

```powershell
cmake --build C:\Users\indro\Projects\data-game\build --config Release
ctest --test-dir C:\Users\indro\Projects\data-game\build -C Release --output-on-failure
```

INDRO verification:

```powershell
node packages\indro\cli.mjs verify-native `
  --root C:\Users\indro\Projects\data-game `
  --build C:\Users\indro\Projects\data-game\build `
  --store D:\hud\experiments\indro-definitive-native-verification\SESSION\iteration-N `
  --configuration Release `
  --evidence-key D:\hud\experiments\indro-definitive-native-verification\native-ed25519.pem `
  --declare-runtime-closure
```

Reproduction:

```powershell
.\experiments\definitive-native-verification\reproduce.ps1 -Mode preflight
.\experiments\definitive-native-verification\reproduce.ps1 -Mode benchmark -Repetitions 5
.\experiments\definitive-native-verification\run-invalidation.ps1
```

The benchmark alternates A ordinary, B fresh INDRO, C unchanged INDRO, D ordinary, and E post-exit INDRO reuse for each of five iterations. Every CLI call starts a new Node process. Setup/configuration of the disposable fixture is excluded from reuse timing. Fresh/miss measurements include build and tests; authenticated hits intentionally include neither and report `buildMs: 0`.

## Artifacts and traceability

- `runs.ndjson`: one structured timing record per measurement (plus one preflight).
- `raw/20261025-235424`: preflight build and CTest logs.
- `raw/20261026-064001`: 25 repaired interleaved benchmark logs and signed receipts.
- `raw/20261026-065438`: five optimized fresh-verification runs.
- `invalidation.json` and `raw/invalidation-20261026-064917`: signed controlled-mutation results and logs.
- `evidence-audit.json` and `raw/integrity-fixed-20261026-065353`: rejected rewrite probe.
- `baseline.json`: source, build, test, toolchain, archive, and runtime identity.

After normalization, `runs.ndjson` SHA-256 is `3006a8368b330fae6539140919c0f11045a270ed3011636021c001b8735d9d9b`; `invalidation.json` is `72d3c2ad3009ada2e02047ca9739ecfb936583edab3838922bedd19148aa31e9`.
