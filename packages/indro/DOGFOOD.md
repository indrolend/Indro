# Indro v0.6 dogfood report

v0.5.1 preserves the v0.5 benchmark results and fixes the Windows PowerShell
parser error caused by the ambiguous `$LASTEXITCODE:` interpolation in
`Indro.psm1`.

v0.6 adds the typed intent compiler while retaining these corpus results as its
empirical vocabulary foundation.

## Corpus

The supplied `hud.zip` contains **863 CommandHUD runs across 17 project namespaces**:

- 663 pass
- 153 fail
- 34 cancelled
- 13 blocked

The retained `run.json` payload totals roughly 728 MiB because several historical stress tests intentionally embed very large evidence payloads.

## Miner performance

The bounded-prefix miner still processes all 863 records with zero malformed entries and roughly 1.5 MiB peak traced Python allocation. Five external wall-clock runs in this build environment were approximately 1.50–1.56 seconds. The host Python process itself has a high baseline RSS, so traced allocation is the more meaningful incremental-memory measure here.

## Intent gap discovered

HUD preserves rich command evidence, but historical objective metadata is sparse at the semantic level:

```text
197 meaningful objectives
477 generic terminal/interactive objectives
189 missing objectives
```

Only **22.8%** of the 863 runs have a non-generic objective. This gives Indro a concrete role: capture semantic intent as the user-facing word/plan and link it to CommandHUD's execution evidence.

A new `crosscheck` test also compared the optimized prefix parser with canonical JSON parsing for 860 ordinary-sized records. It found a real bug: top-level `request: null` could fall through to a later nested `request` string. The parser now treats the first null occurrence as authoritative, and the cross-check passes with **0 mismatches** (3 deliberate huge stress records are skipped by the full-JSON cross-check and remain covered by the bounded-memory benchmark).

## New v0.5 benchmark: semantics vs macros

The corpus is sessionized, noise is removed, and the earlier 80% of semantic sessions is used to discover reusable motifs. The later 20% is held out.

```text
EXACT     train reduction 10.538%   holdout  6.122%
SEMANTIC  train reduction 17.886%   holdout 20.930%
```

The semantic representation first collapses concrete families into phases and removes adjacent repetition. On the holdout set:

```text
98 concrete semantic actions
 -> 43 phase actions
 -> 34 actions after learned phase motifs
```

That is a **56.122% phase-abstraction reduction** and **65.306% total representational reduction to the learned-word trace**. This is a language-design benchmark, not an execution-shortcut claim.

The key finding is that exact shell-family motifs overfit historical command syntax, while the semantic phase vocabulary transfers substantially better to later sessions.

## Stable motifs

Top cross-project motifs include:

```text
orient -> inspect
inspect -> test -> inspect
inspect -> test
tool -> orient -> inspect
inspect -> tool
test -> inspect
test -> compare
inspect -> modify
```

The top-10 motif set was recomputed under 5-, 10-, 20-, and 30-minute session boundaries. Minimum pairwise Jaccard similarity was **0.667**, so the central motifs are not an artifact of exactly one ten-minute cutoff.

## Consequence for Indro

Indro should not become a macro recorder. The useful abstraction is:

```text
raw command -> semantic phase -> evidence-backed word -> inspectable plan
```

`orient` is now explicit vocabulary (`status -> audit`), `resume` resolves through it, and Indro's own development loop is now:

```text
learn = dogfood -> suggest -> measure -> selftest
measure = bench -> languagebench -> crosscheck
```

The next major test remains live PowerShell execution on the Windows workstation against `D:\hud` and the authoritative Digital Breakdown workspace.
