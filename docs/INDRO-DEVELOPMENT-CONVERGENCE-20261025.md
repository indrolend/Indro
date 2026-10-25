# INDRO development convergence — 2026-10-25

## Identity and preservation

- Common ancestor: `cb1a01a8a5d91ee410ea0abd9ba750f0d7ac25a0`.
- Local committed head: `39fa7196ea50b293a49879e1248d561f50f40c30` (`feat/uai-transaction-kernel`).
- Remote native-verification head: `69ccad504fbfb2e3deac235c8a63d9f1ae805b81`.
- Local overlay checkpoint commit on the integration branch: `b62dee260a96138f36281cbdf4cc17885d1cf1d8`.
- Integration merge: `70205d30f6b6bb366fa8a2830001c7500fdd2cc6`, with parents `b62dee2` and `69ccad5`.
- Final validated code head before this report-only update: `7e4acbddb49419019f7cafef9a53159784485301`.
- Integration worktree: `C:\Users\indro\Projects\Indro-convergence-20261025`.
- Original worktree remains on `feat/uai-transaction-kernel` at `39fa719` with its original 15 tracked modifications and 23 untracked files.

The complete pre-integration checkpoint is at
`D:\hud\checkpoints\indro\20261025-105900-feat-uai-transaction-kernel-39fa719`.
It contains a verified all-ref Git bundle, staged and unstaged binary patches,
the Git index, status, exact copies of all 38 changed or untracked files, and a
SHA-256 manifest. `git bundle verify` reported complete history. All 46 recorded
checkpoint files and all 38 overlay files were rehashed successfully.

- `SHA256SUMS.json`: `50516747d0eba71828256cc140344fb0750d52d7f7a9f5cce518543c3c36d9a5`.
- `repository.bundle`: `7f6ad5e5b03abeb82493187a9520ad5a954de334f0c74e8c950f3d4afc2a3be7` (1,205,400 bytes).

## Semantic convergence

The canonical `indro` CLI retains all existing routes: language compilation,
proof planning, workbench inspection, UAI application fixtures, Godot replay and
calibration, native verification, and CommandHUD compatibility fallback. Help
and dispatch remain in one top-level CLI. A local help-string defect containing
literal `\n` text was corrected while resolving the conflict.

The Indro package test command now composes CLI, native verification, Godot
replay, calibration negative controls, and all Python suites. `MANIFEST.json`
contains both streams and matches the exact current file bytes.

Native verification retains its scoped append-only CTest receipt format and
fail-closed reuse checks. CommandHUD retains its generic reusable-command
evidence contract and independently validates raw evidence, descriptors, input
and dependency fingerprints, environment, and evidence identity. Godot replay
continues to emit INDRO-owned artifact manifests and explicitly makes no replay
reuse or cross-machine performance claim.

The terminal ConPTY integration test previously assumed the checkout directory
was literally named `Indro`. It now derives the verified repository basename,
so the same behavior is testable in an isolated worktree.
Inherited terminal-source line endings and EOF padding were normalized after a
whole-range `git diff --check` exposed them; the final common-ancestor-to-code-
head check passes.

## Conflict resolution

Git reported three content conflicts:

1. `packages/indro/cli.mjs`: retained `work`, `app`, and `godot`; added
   `verify-native`; kept CommandHUD fallback.
2. `packages/indro/package.json`: composed all four JavaScript suites instead of
   choosing one development stream.
3. `packages/indro/MANIFEST.json`: retained both file sets and recomputed bytes
   and SHA-256 values from the resolved tree.

No unresolved Git conflicts remain.

## Verification

All commands below ran in the integration worktree and returned exit code 0
unless explicitly described otherwise.

- `npm test`: CommandHUD 170/170; merged Indro JavaScript 36 passed and five
  platform-inapplicable tests skipped; Python self-tests 12/12.
- `node --test packages/indro/native-verify.test.mjs`: 23 passed, five skipped
  on Windows. Covered cold execution, unchanged reuse, changed source/binary/
  configuration/runtime/environment invalidation, corrupt and contradictory
  receipts, missing dependencies, compiler conflicts, disabled/skipped CTest
  plans, CLI rejection, NUL framing, and nested Git-root rejection.
- Godot replay, calibration, and CLI focused suite: 13/13. Negative controls
  rejected missing protocol output, failed assertions, missing or tampered
  captures, malformed results, missing EOF, missing executables, and clipboard
  failure.
- CommandHUD reusable evidence and shell suite: 21/21. Changed inputs, failed
  records, missing bytes, tampering, staleness, and mismatched descriptors all
  rejected reuse.
- UAI transaction, finite assay, and workbench suite: 23/23.
- Digital Breakdown terminal package: 44/44, including a real WebSocket and
  ConPTY recovery test.
- Package manifest, NDRA repository gauntlet, convergence gauntlet, and
  `git diff --check`: pass.

The task prohibited changes to `data-game`; therefore no live Godot replay or
real data-game CMake build was executed during convergence. Replay operation is
established by its protocol/integrity/negative-control suite, not by a new
performance claim.

## Remote CI investigation

At remote head `69ccad5`, both `Native verification evidence` workflow runs
passed on Ubuntu and Windows. The separate `Indro checks` matrix failed on all
three platforms. Those failures are not concealed by this integration:

- The workflow does not install the root package dependency before invoking
  `mcp-server.test.mjs`, producing `ERR_MODULE_NOT_FOUND` for
  `@modelcontextprotocol/sdk`.
- Linux and macOS expose existing shell/cwd persistence, search-count, doctor,
  sandbox, and server portability failures.
- Windows additionally exposes launcher path normalization and several
  CommandHUD fixture expectation failures.

These failures predate this integration and are outside the native-verification
workflow, which is green. Local Windows suites pass after locked dependencies
are installed. No CI result was bypassed, modified, or rerun from this branch.

## Remaining limits and review state

- Five native tests require POSIX permission or symlink semantics and are
  skipped on Windows; remote Ubuntu native jobs cover those paths.
- Godot replay evidence reuse remains explicitly unimplemented and unclaimed.
- Native CTest reuse remains scoped to declared runtime closure and fails closed
  when closure or provenance cannot be established.
- `npm ci` reports known dependency audit findings (root: three moderate and
  three high; terminal package: one high). No automatic audit fix was applied.
- General cross-platform CommandHUD CI remains unresolved as described above.
- The integration branch is local only. It has not been pushed or merged into
  `main` or either source branch.

The converged tree is ready for human review of the integration itself. It is
not ready to claim a fully green repository CI matrix until the separate
CommandHUD portability and workflow dependency issues are resolved.
