# Indro v0.7 — semantic compression and proof planning

Indro optimizes software development for **semantic work per explicit token**.
Long-form source remains available for learning and documentation; compact
source and compact IR reduce memory and context cost while compiling to the
same semantic plan ID.

```indro
@repair
!"repair ${target}, prove the change, and retain evidence"
$target:path
+rwx
:main
  >o
  >ck
  >p ${target}
  ?"tests pass for ${target}"
```

Compact forms are contextual and reversible: `>o` means `do orient`, `+rwx`
means `permit read write exec`, `?` introduces a postcondition, `||` a
parallel group, and `~` a recovery path. Abbreviations never bypass effect
checking.

Use `--format compact` to emit a token-efficient IR for an agent. The included
repair example compiles to the same plan as long form while using 330 rather
than 511 source bytes; compact IR uses 749 rather than about 2,000 bytes.

## Proof-aware minimal plans

`indro_proof.py` plans only stale proofs. Given cached fingerprints, changing
tests reruns `test -> smoke -> verified`, changing only runtime reruns
`smoke -> verified`, and an unchanged state runs nothing. Fingerprints include
exact semantic inputs and dependency-proof fingerprints; unknown inputs never
produce a cache hit.

Indro is now both a compact command vocabulary and a typed language for
software-development intent. A `.indro` program compiles to a deterministic,
inspectable plan before any workspace adapter is allowed to execute it.

## Compile a development program

```powershell
Compile-IndroProgram .\examples\repair.indro `
  -Set target=Indro.psm1 `
  -AllowEffect write `
  -Check
```

The same compiler is portable:

```text
python indro_lang.py examples/repair.indro --set target=Indro.psm1 --allow-effect write
```

The language supports typed parameters (`string`, `path`, `integer`,
`boolean`, and `choice(...)`), intent declarations, nested word expansion,
parallel groups, recovery plans, assertions, evidence events, deterministic
plan IDs, and static effect inference.

Effects are declared in source and checked again at invocation. Read and local
execution are inspectable; write, network, and publish authority must be
explicitly granted. Consequential words such as `ship` may not be hidden by a
composite.

Indro is a small evidence-native language for software work. It is being derived from real CommandHUD history rather than hypothetical CLI conventions.

The supplied dogfood corpus contains **863 structured runs across 17 project namespaces**. `D:\hud` remains the preferred evidence substrate; Indro adds only small intent/plan envelopes under `D:\hud\indro\runs`.

## Install on the Windows workstation

```powershell
.\doctor.ps1
.\install.ps1
learn
indro plan mature
status
```

The installer parses the module, validates JSON, runs Python self-tests when available, backs up the existing Indro module and PowerShell profile, backs up live workspace adapters, and preserves existing `tools\dbdev.ps1` and `tools\ollama-playtest.py` rather than replacing them.

## What v0.5 learned from HUD

v0.4 proved that the evidence miner could process the full corpus cheaply. v0.5 tests a more important hypothesis: **Indro should encode semantic development phases, not exact shell macros.**

The benchmark trains motifs on the earlier 80% of semantic sessions and evaluates them on the later 20%:

```text
exact command-family motifs:  6.122% holdout token reduction
semantic Indro motifs:       20.930% holdout token reduction
phase abstraction itself:     56.122% holdout reduction
phase + learned motifs:       65.306% representational reduction
```

The last two figures are historical trace representation metrics, not claims that Indro can safely skip that percentage of future commands.

A second dogfood finding sharpened Indro's purpose: only **197 / 863 (22.8%)** historical HUD runs carry a non-generic objective; 477 carry generic terminal/interactive objectives and 189 have no objective. CommandHUD is strong at execution evidence, but much of its historical corpus lacks semantic intent. **Indro should be the intent layer that names the work before CommandHUD records how it happened.**

`suggest` now separates **CORE** motifs (cross-project) from **DIALECT** motifs (strong within one project). In this corpus, repeated `build -> test -> build` behavior is primarily an `indrolend/data` dialect signal, while `orient -> inspect` generalizes across projects. This keeps project-specific habits from bloating the core language.

The strongest cross-project motif is:

```text
orient -> inspect
```

It appears 18 times across 3 project namespaces in the full semantic corpus. Other reusable signals include `inspect -> test -> inspect`, `inspect -> test`, `test -> compare`, and `inspect -> modify`.

This result supports a language organized around **intent phases and evidence transitions**, rather than a collection of aliases for Git/npm/CMake commands.

## Self-hosting words

```text
dogfood       mine CommandHUD history
suggest       propose project-diverse semantic motifs
bench         benchmark HUD mining correctness/performance
languagebench benchmark semantic generalization + session stability
measure       bench -> languagebench -> crosscheck
selftest      run Indro's test suite
learn         dogfood -> suggest -> measure -> selftest
```

Workspace words include `orient`, `resume`, `audit`, `checkpoint`, `save`, `prove`, `verify`, `build`, `test`, `smoke`, `play`, `doctor`, `agent`, `recover`, `harden`, `probe`, `mature`, `handoff`, and explicit `ship`.

`ship` is consequential and must be invoked explicitly. Composite words cannot imply `commit`, `push`, `merge`, `rebase`, `reset`, `clean`, `release`, `publish`, or `ship`.

## Portable dogfood runner

Where PowerShell is unavailable:

```text
python indro.py --hud-root <hud-root> learn
```

The portable runner executes only Indro's self-analysis vocabulary. Workspace/game operations remain owned by the PowerShell backend.

## Dependencies

For the full Digital Breakdown workflow: PowerShell 7, Git, Python 3, CMake, and the existing game workspace. Ollama is optional and used by `agent`. Third-party executables are not redistributed.

## Validation status

Validated in the build environment:

- all 863 HUD runs parsed with zero malformed records;
- Python package compiles;
- 6 self-test groups pass;
- mining performance benchmark passes;
- language holdout/generalization benchmark passes;
- top-10 semantic motifs remain reasonably stable across 5/10/20/30-minute session gaps (minimum Jaccard 0.667);
- Indro successfully runs its own `learn` plan.

PowerShell 7.6.6 static parsing and isolated module import have been validated
for v0.5.1. Installation and live workspace execution remain intentionally
unperformed by this repair build.
