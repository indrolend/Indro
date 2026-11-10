# Open-source validation

INDRO's first public cross-repository assay is intentionally bounded. It compares ten adjacent first-parent commits from five pinned Python libraries: toolz, boltons, more-itertools, funcy, and attrs. Repository code is parsed from Git blobs but never imported or executed.

The `Open-source bounded semantic gauntlet` GitHub workflow runs the safe-AST model self-test, accounts for every discovered changed function, compares the bounded observations, benchmarks cold and warm verification strategies, fails on any audited false skip, and retains `results.json`, comparison and exclusion tables, and reuse justifications as a public artifact.

Run the same assay against checkouts with matching directory names:

```text
python packages/indro/tools/ndra_repo_gauntlet.py --workspace <workspace> --output <evidence> --history 10 --max-inputs 128 --trials 3
```

`EQUIVALENT` is emitted only for canonical AST identity. A concrete differing observation is a `COUNTEREXAMPLE`; matching finite observations and unsupported constructs remain `UNKNOWN`. The assay therefore tests bounded safe analysis and reuse accounting—not arbitrary Python behavior, package correctness, or universal equivalence.

The 2026-11-10 current-upstream local trial inspected 50 adjacent commit pairs. It accounted for 140 changed-function comparisons and 2,918 exclusions (3,058 total function records) with zero false skips. Exact caching reduced the measured warm median from 41.45 ms to 1.86 ms. Proof reuse measured 1.79 ms but saved no verification evaluations beyond exact caching on this corpus; that is a negative optimization result, not evidence of a general semantic-reuse advantage.

## Language-agnostic repository-state workflow

The `Multilanguage claim-directed repository state` workflow invokes the public objective `Verify current repository state.` against pinned ripgrep (Rust), cobra (Go), Express (JavaScript), and fmt (C++) checkouts. For each repository it asserts this sequence:

1. A cold objective executes and retains evidence.
2. The equivalent warm objective reuses the same evidence identity.
3. Moving the clean checkout to its parent commit invalidates reuse and creates different evidence.
4. Restoring the original commit reuses the original evidence identity.

Only Git state is observed; no external build, test, package lifecycle, or repository source is executed. The artifact retains the compact receipts, per-phase wall time, immutable CommandHUD records, and a SHA-256 manifest. This establishes cross-language source-state applicability and invalidation, not application behavior.

## External native behavioral workflow

The `External native claim-directed verification` workflow builds and tests pinned fmt source through the existing CMake/CTest verifier. The workflow derives the declared shared-library closure from the configured CTest executables, records one explicit verified invocation, and then resolves `Verify current native tests behavior.` from retained CommandHUD history.

It asserts warm reuse, changed-HEAD execution, reuse at the changed HEAD, restored-HEAD execution, and subsequent restored-state reuse. Restoration intentionally executes once: the native verifier fails closed against the newest receipt and does not silently fall back to an older success. Receipts retain source, build graph, compiler, CMake, CTest, executable, environment, runtime-file, behavioral output, and cost evidence. This is the first external application-behavior assay; its runtime-closure claim is bounded to the recorded CTest plan, tracked source, selected environment, and enumerated dynamic libraries.

## External software-type execution assay

The `External software-type command assay` runs repository-owned tests directly and through `indro run --objective` in interleaved order for a pinned JavaScript server, Go CLI library, Rust library, and Python library. It verifies successful exit behavior, immutable stdout/stderr integrity, faithful preservation of an exit-7 negative control, and an unchanged Git worktree. Toolchain identity and complete end-to-end timing are retained with each result.

This assay does not reuse test results. Its purpose is to quantify the cost and correctness of INDRO's general evidence funnel and to falsify any claim that evidence recording automatically accelerates first execution. Repository-specific test commands remain the behavioral authority.

The first hosted run exposed two fixture-boundary errors before establishing the contract: Express had no lockfile for `npm ci`, and byteorder's `--all-targets` selected a nightly-only benchmark on stable Rust. The corrected matrix ran 1,290 Express tests, 936 more-itertools tests, Cobra's Go packages, and byteorder's stable library tests. A lower recorded INDRO median in a cold-first sequence is not acceleration evidence: direct execution populated compiler/test caches before INDRO. Express instead measured 180 ms of median recording overhead. Preserve these as counterexamples against interpreting interleaved wall time without symmetric warm-up or order balancing.
