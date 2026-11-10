# Claim-Directed Amortized Verification

Status: research hypothesis, not a novelty claim.

## Research question

Can software verification be treated as incremental computation over composable,
dependency-scoped evidence, so that a system selects the least-cost missing proof
for a behavioral claim and amortizes that proof across future objectives?

INDRO currently demonstrates two bounded instances: Godot replay evidence and
native CMake/CTest verification. This document defines the proposed general
problem and the experiments required before claiming a new contribution.

## Problem model

Let:

- `S` be current source, runtime, environment, and temporal state.
- `C` be a requested behavioral claim.
- `E` be retained evidence fragments.
- `D(e)` be the dependencies under which evidence fragment `e` is applicable.
- `P(e)` be the properties established by `e`.
- `A` be candidate observations or executions.
- `K(a)` be measured execution, validation, storage, and retrieval cost.

Evidence is usable only when its integrity is valid and `D(e)` matches `S`.
A claim is resolved when the applicable evidence entails the required property:

```text
applicable(E, S) and coverage(E) entails C
```

Otherwise select an action sequence `A'` minimizing total cost while producing
the missing coverage:

```text
minimize K(A' | S, E)
subject to coverage(E union result(A')) entails C
```

The lifetime form also accounts for expected future work avoided:

```text
net_cost = current_cost + validation_cost + retention_cost
           - expected_future_work_avoided
```

This model is useful only if coverage, applicability, and entailment are more
than labels. Each must be executable or independently checkable.

## Evidence fragment contract

An evidence fragment should identify:

- the property it establishes;
- exact source, runtime, input, environment, and temporal dependencies;
- the observation or validator that produced the verdict;
- integrity identity and artifact locations;
- synchronization identity such as operation, tick, or frame;
- generation and revalidation cost;
- known limits and explicitly uncovered properties.

Examples from the current Godot path:

| Fragment | Covered property | Does not establish |
|---|---|---|
| deterministic commands | reproducible requested input | input was handled correctly |
| state observations | selected simulation states occurred | visual fidelity |
| assertions | declared behavioral predicates passed | undeclared behavior |
| PNG frames | rendered pixels at selected frames | temporal continuity |
| video | encoded visual continuity | simulation correctness by itself |
| manifest and ZIP hashes | retained artifact integrity | semantic correctness |
| dependency descriptor | applicability boundary | dependency completeness by itself |

## Closest established work

The following areas are prior art, not INDRO discoveries:

- self-adjusting and incremental computation reuse prior results after input
  changes;
- content-addressed execution and build systems identify computations by inputs
  and dependencies;
- provenance systems align reproduced executions and answer historical what-if
  queries using affected dependency slices;
- causal diagnosis compares execution dependencies rather than pass/fail alone;
- proof-carrying systems retain independently checkable certificates;
- value-of-information and metareasoning select observations using expected
  decision value and cost.

Primary starting references:

- Yanhong A. Liu, *Incremental Computation: What Is the Essence?*, 2023:
  https://arxiv.org/abs/2312.07946
- Charlie Curtsinger and Daniel W. Barowy, *Riker: Always-Correct and Fast
  Incremental Builds from Simple Specifications*, USENIX ATC 2022:
  https://www.usenix.org/conference/atc22/presentation/curtsinger
- Sadjad Fouladi et al., *From Laptop to Lambda: Outsourcing Everyday Jobs to
  Thousands of Transient Functional Containers*, USENIX ATC 2019:
  https://www.usenix.org/system/files/atc19-fouladi.pdf
- Yuta Nakamura, Tanu Malik, and Ashish Gehani, *Efficient Provenance Alignment
  in Reproduced Executions*, TaPP 2020:
  https://www.usenix.org/conference/tapp2020/presentation/nakamura
- Bahareh Sadat Arab and Boris Glavic, *Answering Historical What-if Queries
  with Provenance, Reenactment, and Symbolic Execution*, TaPP 2017:
  https://www.usenix.org/conference/tapp17/workshop-program/presentation/arab
- Mona Attariyan and Jason Flinn, *Using Causality to Diagnose Configuration
  Bugs*, OSDI 2008:
  https://www.usenix.org/legacy/event/usenix08/tech/full_papers/attariyan/attariyan_html/index.html

## Candidate contribution

The candidate contribution is the combination of:

1. behavioral claims rather than commands or build artifacts as the selection
   target;
2. composable coverage across synchronized state, terminal, visual, temporal,
   performance, and integrity evidence;
3. reuse of workflow definitions even when their prior results are stale;
4. fail-closed applicability based on domain-owned validators;
5. selection of the least-cost missing proof rather than merely a cached result;
6. retention decisions incorporating expected future verification work avoided.

This combination must be shown to solve a problem not already handled by a
standard content cache, incremental build system, provenance query, or fixed
test-impact selector.

## Falsifiable hypotheses

### H1: Claim coverage avoids unnecessary work

For objectives requiring only a subset of a prior evidence bundle, a
claim-coverage selector should produce the same correct verdict as full replay
while executing fewer processes and validating fewer bytes.

### H2: Workflow-definition reuse remains valuable after result invalidation

When dependencies invalidate retained results, recovering the prior workflow
definition should reduce discovery operations and time to first valid evidence
without increasing false acceptance.

### H3: Causal slices outperform complete retention

For recurring objectives, a bounded causal evidence slice should minimize total
capture, storage, retrieval, and revalidation cost compared with both no
retention and full snapshot retention.

### H4: Multimodal first divergence improves diagnosis

Synchronizing input, simulation, presentation, rendering, and terminal evidence
should localize the owning failure boundary with fewer follow-up observations
than final-verdict or final-frame comparison.

## Baselines

Every experiment should compare at least:

1. full re-execution;
2. exact command/result cache;
3. content-addressed dependency cache;
4. latest successful historical workflow;
5. full evidence-bundle retention;
6. claim-directed evidence selection.

Report false reuse and false rejection, not only latency.

## Measurements

- time to first relevant observation;
- time to justified verdict;
- selection, validation, and execution time;
- processes and commands invoked;
- files and bytes inspected;
- artifacts generated, retained, and retrieved;
- false acceptance and false rejection;
- first-divergence localization accuracy;
- human or agent follow-up operations;
- future work avoided by retained evidence.

Measured facts must remain separate from estimates.

## Smallest discriminating experiment

Use one existing Godot evidence bundle and define three claims:

1. simulation reached the asserted room;
2. a selected frame rendered successfully;
3. temporal visual continuity exists.

Compare full replay against validation of only the fragments needed by each
claim. Introduce controlled mutants: corrupt one observation, one PNG, and the
video while preserving the other fragments. A valid selector must:

- accept only claims whose required fragments remain valid;
- avoid decoding or regenerating irrelevant artifacts;
- report the uncovered or invalid property precisely;
- never reuse a workflow result merely because its process exited zero.

This experiment distinguishes claim-specific evidence coverage from ordinary
whole-command caching without requiring a new database or generalized planner.

### Initial result

The first run used the retained replay at
`evidence/godot-replay/2026-10-25T16-56-22-328Z-2d0d21a1-9404-4e55-b177-5c267a3cbf46`
with 15 trials per validator. The experimental tool is
`packages/indro/tools/claim-coverage-experiment.mjs`.

| Claim | Valid median | Attributed bytes | Child processes |
|---|---:|---:|---:|
| behavior | 0.0243 ms | 11,746 | 0 |
| selected PNG frame | 0.0038 ms | 176,433 | 0 |
| video continuity | 51.2217 ms | 72,917 | 1 |
| all fragments | 51.0754 ms | 261,096 | 1 |

Controlled mutants were property-local: corrupt observation JSON rejected the
behavior and full claims while the frame and video claims remained valid; a
corrupt PNG rejected only the frame and full claims; a missing video rejected
only continuity and full claims. No mutant was falsely accepted for the
property it damaged.

This is evidence for H1's mechanism, not yet for its generality. The frame check
establishes only a PNG signature, and the video check establishes only positive
container duration. The experiment does not perform semantic image analysis,
prove dependency completeness, compare against full runtime replay, or establish
novelty. Its immediate value is a reproducible separation between whole-bundle
validation and property-specific fragment validation.

### Second-domain result

The native experiment used the current 57-test DATA receipt
`2026-11-09T21-51-24.722Z-2684b557-75a1-4bfb-90b1-dcfe7f6da4cc.json`
with 1,000 trials per validator. Its tool is
`packages/indro/tools/native-claim-coverage-experiment.mjs`.

| Native claim | Valid median |
|---|---:|
| receipt and snapshot provenance | 0.0514 ms |
| recorded behavioral test success | 0.0001 ms |
| declared runtime closure | 0.0001 ms |
| all receipt fragments | 0.0519 ms |

A corrupt integrity digest rejected provenance but not the independently read
behavior/runtime fields. A consistently re-signed failed execution retained
valid provenance but failed the behavior claim. A consistently re-signed
receipt with its runtime list removed retained provenance and behavioral success
but failed the runtime-closure claim. The full claim rejected all three mutants.

This second domain supports compositional proof coverage as an implementable
mechanism across graphical replay and native verification. It still does not
show that receipt-only validation is applicable to current source or runtime;
`verifyNative` remains authoritative for that decision. The result is a
cross-domain mechanism demonstration, not a comparison against prior systems or
a novelty result.

## Novelty threshold

Do not claim a fundamental discovery unless the work produces at least one of:

- a formal model with a sound composition rule not reducible to existing
  provenance or incremental-computation models;
- a new algorithm with a proved bound or separation result;
- a reproducible workload where established caches and test selection cannot
  safely exploit evidence that claim-directed composition can;
- an independently reproduced empirical law about causal retention value.

Until then, describe INDRO as an experimental system exploring claim-directed,
multimodal amortized verification.

## Current assessment

No never-before-seen fundamental computer-science result is established. The
current mechanisms substantially overlap incremental computation,
content-addressed execution, provenance, causal diagnosis, and proof-carrying
systems. The two experiments do establish a narrower engineering result:
heterogeneous evidence can be decomposed into independently falsifiable claim
fragments, allowing irrelevant validators and processes to be skipped without
accepting the controlled property-local mutants.

The highest-value unresolved boundary is an applicability-aware coverage
selector that chooses these fragments from an objective and current state. A
credible research claim requires comparing that selector against exact caching,
full-bundle validation, and test-impact/provenance baselines on multiple unseen
workflows, including false-reuse adversaries. Do not add a database before this
selection workload demonstrates that the existing append-only evidence scan is
the limiting cost.
