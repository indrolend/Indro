# INDRO definitive native verification experiment

## Scope and identity

This is a falsification experiment against the real Digital Breakdown CMake/CTest workload. Production verifier code and the authoritative game source were not edited. The experiment uses INDRO commit `69ccad504fbfb2e3deac235c8a63d9f1ae805b81` and the dirty game checkout at commit `8e6824278f1226f0d74950688d6cf7badb736d30`. Exact dirty paths, tool versions, build identity, and runtime assumptions are in `baseline.json`.

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
  --configuration Release --declare-runtime-closure
```

Reproduction:

```powershell
.\experiments\definitive-native-verification\reproduce.ps1 -Mode preflight
.\experiments\definitive-native-verification\reproduce.ps1 -Mode benchmark -Repetitions 5
.\experiments\definitive-native-verification\run-invalidation.ps1
```

The benchmark alternates A ordinary, B fresh INDRO, C unchanged INDRO, D ordinary, and E post-exit INDRO reuse for each of five iterations. Every CLI call starts a new Node process. Setup/configuration of the disposable fixture is excluded from reuse timing and separately visible in shell history; each measured INDRO total includes its mandatory no-op build and fingerprint overhead.

## Artifacts and traceability

- `runs.ndjson`: one structured timing record per measurement (plus one preflight).
- `raw/20261025-235424`: preflight build and CTest logs.
- `raw/20261025-235454`: 25 interleaved benchmark logs and copied receipts.
- `invalidation.json` and `raw/invalidation-20261026-000349`: controlled mutation results and logs.
- `evidence-audit.json` and `raw/integrity-20261026-000855`: corruption and authenticated-rewrite probes.
- `baseline.json`: source, build, test, toolchain, archive, and runtime identity.

`runs.ndjson` SHA-256 before this report was written: `e3b98354a01172c7da195c71d559f88e936a8725ff3e0f92549a193afaeb3ceb`. `invalidation.json` SHA-256: `cb06cdff0a1075082eb26ae87f4b8f72798a4e8c6456f2965d75d84a243550b5`.
