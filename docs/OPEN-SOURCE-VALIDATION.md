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
