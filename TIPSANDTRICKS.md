# INDRO Tips & Tricks

This is the fast path to previously verified operational knowledge. It does not replace INDRO, repository tests, Git, or detailed evidence. Consult it before broad reconnaissance or new tooling.

## Compute rules

- Optimize total time to a correct, verified result: **minimum observation → minimum intervention → proportional verification**.
- Ask the cheapest question that can change the next decision. Stop gathering when the intervention is determined.
- Prefer bounded output (`rg` scope, explicit files, small history count, selected JSON fields). Large output costs disk I/O, context, and attention even when the command is fast.
- Reuse a verified capability before recreating it. Classify it as **discovered → invocable → connected → behaviorally verified**; a file or help entry proves only the first stages.
- Preserve dirty work. Record branch, commit, and dirty identity before mutation; never treat an old clean revision as the current runtime.
- Separate evidence generation from verification. Exit zero, valid hashes, and plausible screenshots prove different things.
- Retain only verified, reusable, non-obvious, actionable knowledge whose expected future savings exceed retrieval and maintenance cost.

Governing loop: **consult → observe current state → reuse → execute the smallest operation → verify → retain only leverage**.

## Reconnaissance: establish authority without exporting the world

### Repository, source identity, and runtime

**Use when:** starting repository work or resuming a dirty task.

**Method:** from the suspected repository, use targeted identity queries first:

```powershell
git rev-parse --show-toplevel
git branch --show-current
git rev-parse HEAD
git status --short
Get-Command indro,godot_console.exe -ErrorAction SilentlyContinue | Select-Object Name,Source
```

Use `indro work inspect <path>` when a durable top-level inventory or file hash is useful. It records a UUID under `.indro/evidence`. Use `indro state --json` only when a consumer truly needs its complete project/repository/runtime snapshot; on DATA it includes the full repository tree and dirty listing and can emit thousands of lines.

**Verify:** root, branch, commit, dirty state, and executable path all refer to the intended project. A binary path alone does not prove the running process loaded current source.

### Find the smallest relevant surface

1. Search filenames first: `rg --files <scope> | rg '<term>'`.
2. Search symbols only in likely directories and extensions: `rg -n '<symbol>' game native godot -g '*.cpp' -g '*.hpp' -g '*.gd'`.
3. Read the narrow surrounding range, then follow direct references.
4. Expand to history or the whole repository only if the targeted path cannot answer the decision.

This sequence avoids repeated whole-tree searches and avoids loading generated evidence, binaries, media, or dependencies into context.

### Discover existing capability

- Public surface: `indro --help`.
- Recent executions: from the target project root, run `indro history <small-count>`; history is project-scoped, so an empty result from another repository is not evidence that no execution exists. Filter before increasing the count.
- Semantic/history lookup: `indro search <query> [scope]`.
- Durable workbench evidence: `indro work evidence <uuid>`.
- Implementation truth: inspect the exact dispatcher and implementation under `packages/indro/` or `packages/commandhud/`.

CommandHUD history run IDs (for example timestamp-plus-suffix IDs) are not `indro work evidence` UUIDs. Do not send one namespace to the other command.

Objective recovery scans recent history progressively: 10 records, then 100,
then the existing 1,000-record bound only if the recognized workflow family is
still missing. On a 228-run DATA history this reduced history recovery from
84.89 ms to 4.79 ms median while finding the same Godot and native workflows.
Do not replace this with a database until measured history retrieval again
dominates total cost; current native applicability acquisition is much larger.

## Execution and evidence

INDRO is the public operational interface. Keep repository-specific fixtures and assertions in their repository rather than adding a parallel executor.

### Smallest verified Godot behavioral capture

**Use when:** input, state progression, rendered frames, or continuous video must be proven.

```powershell
$env:INDRO_EVIDENCE_ROOT = '<explicit output directory>'
indro godot replay --scenario smoke --capture
# Add --video only when temporal continuity is part of the claim.
# Use --commands <verified.commands> for a specific deterministic path.
```

The replay records source/dirty identity, commands, observations, assertions, logs, captures, manifest hashes, and a ZIP. Verify behavior from assertions/observations and artifact completeness from the manifest; neither substitutes for the other.

The calibrated canonical replay compressed manual coordination from five steps to one with 3/3 passing trials and 6/6 correct negative controls. It was slower in wall time than the direct script in that small calibration, so use it for coordination and evidence integrity—not as an unqualified speed claim. Evidence: `evidence/godot-replay/calibration-2026-10-25T17-06-38-547Z-0a7797e7-04c6-4993-8051-722d47e0e7eb/summary.json`.

### Choose the minimum evidence set

- Logic/state claim: deterministic input + assertions + relevant telemetry.
- Appearance claim: matched screenshots at the decision states; video only for motion/continuity.
- Performance claim: warm-up, multiple interleaved trials, median/p95/worst CPU and GPU, draw calls, primitives, memory, exact resolution/renderer/vsync.
- Long-run stability: bounded soak with state parity, resource identity, and post-settling—not startup-to-end—memory/object deltas.
- Source/runtime claim: revision, dirty hash/list, executable path/version, and dependency hashes when relevant.

Never generate every artifact “just in case.” Start with telemetry/assertions; add images, then video, only when the claim requires them.

### Evidence reuse

- Implementation authority: `packages/commandhud/evidence-reuse.mjs`.
- Reuse requires explicit repository identity, argv, inputs, dependencies, and environment; fingerprints are deterministic SHA-256 hashes.
- Raw stdout/stderr sizes and hashes are checked. Invalid or incomplete identity requires fresh execution.
- Reuse applies to defined verification, not arbitrary mutations. Plain `indro run -- <command>` delegates to CommandHUD; it does not imply reusable verification.
- For a repository with retained replay history, `indro run --objective "Verify the current Godot gameplay replay."` recovers the latest replay options, recomputes current source/runtime/dependency identity, and then executes or reuses the existing verified workflow. It fails closed when no matching retained workflow exists; use an explicit `indro godot replay ...` once to establish one.
- Objective selection now shares one bounded candidate selector across Godot replay and native verification. Candidates must be successful, current-project workflow definitions before cost ranking; domain validators still own applicability and behavior.
- Native selection requires one successful historical `indro run --objective ... -- <verify-native argv>` with `--declare-runtime-closure`. Thereafter, `indro run --objective "Verify the current native test suite."` recovers that invocation and lets the native verifier build, validate its source/compiler/CMake/CTest/runtime/verifier/Node identity, then execute or reuse its append-only receipt. Do not declare closure unless every relevant external runtime file is named with `--runtime-file`.
- Before rerunning, search history/evidence and compare the recorded identity with current state. Reuse the conclusion only when the behavioral contract and dependencies match.
- Native reuse validates the complete current snapshot before invoking CMake.
  An exact match to the newest integrity-validated receipt skips the no-op build;
  any source, cache, plan, executable, compiler, tool, runtime, verifier, Node,
  environment, completeness, or integrity mismatch retains build and CTest.
  DATA warm objective median fell from 5.99 seconds to 1.299 seconds; do not
  weaken the snapshot to chase the remaining floor.
- Snapshot tool discovery resolves CMake, CTest, and Git together and hashes
  their exact binaries. Do not restore separate locator or `--version` probes:
  they added process latency without strengthening identity. After removing
  them, the measured DATA warm median was 1.132 seconds (81.1% below baseline).
- Tool lookup itself uses the declared executable search path directly rather
  than launching `where.exe`/`which`; the chosen files are still canonicalized
  and SHA-256 hashed. This reduced the DATA warm median to 0.921 seconds (84.6%
  below baseline). Do not replace exact hashes with size/timestamp caches.

## Analysis and profiling decision rules

### Find the first divergence

Compare deterministic runs at the earliest unequal frame/state and inspect only the fields that changed. Later differences are often consequences. For parity tests, keep one authoritative control and one presentation/runtime under test; compare snapshots at bounded intervals before collecting verbose logs.

### Profile before optimizing

1. Isolate the subsystem (for rooms, disable enemies; for enemy presentation, keep the room fixed).
2. Establish a matched opt-out baseline in the same binary, resolution, renderer, and workload.
3. Measure component timings plus render counters; do not infer the bottleneck from scene complexity.
4. Change only the measured dominant path.
5. Re-run matched visual and behavioral parity, then the complete sweep.

Observed DATA examples: Field grass was draw/object bound and benefited from `MultiMesh`; City had both repeated facade draws and ~0.45 ms/frame of static dictionary transfer. Global facade batching reduced draws but destroyed culling and raised primitives ~195%; spatially bounded batching retained the CPU win with a bounded ~24% primitive tradeoff. The reusable rule is: **batching reduces submission cost but expands culling granularity—measure draws, primitives, CPU, GPU, and image parity together**.

Use graphs only when a recurring decision is obscure in tables/logs: first-divergence timelines, state transitions, dependency/execution flows, causal failure chains, or repeated workflow cost. Do not graph a single comparison that a short table answers.

## Known causal failure modes

### Manual stepping plus automatic processing

**Symptom:** a manually controlled Godot runtime diverges from an otherwise identical native control after yielding frames.

**Cause:** automatic `_process`/physics advancement continues while the test also calls manual `tick()`, so one side advances twice.

**Correction:** after scene initialization, disable automatic processing on the manually stepped world, then advance both sides exactly once per input. Check the first post-yield frame. This was verified during the 18,000-step enemy-population soak investigation.

### First-use render stalls hidden by median/p95

**Symptom:** steady-state metrics improve but worst frame regresses sharply at the first exceptional visual state.

**Cause:** a render surface/pipeline is allocated or compiled only when that state first appears (observed on the first cracked enemy shell).

**Correction:** record the worst frame index and relevant state, then preallocate/render-warm only the exceptional surface. Re-profile worst as well as median/p95; do not accept a steady-state win that creates a hitch.

### Integrity is not behavior

- Exit zero proves process completion, not the intended gameplay result.
- A manifest proves recorded bytes are intact, not that dependencies were complete.
- A source file proves implementation exists, not that the active runtime loaded it.
- A screenshot proves one frame, not input handling or temporal continuity.

Choose a verifier for each claim instead of treating one green signal as universal proof.

For retained Godot evidence, name the property in the objective: `Godot replay behavior`, `visual appearance`, `artifact integrity`, or `video continuity`. Behavior-only validation deliberately does not read PNG bytes; visual validation does. A continuity objective upgrades a retained non-video replay invocation to collect video once, then uses `ffprobe` on warm reuse. The unqualified replay objective retains the established behavior + visual + artifact-integrity contract.

For native work, `Verify native provenance` validates the complete current source/build/tool/runtime snapshot without launching CMake or CTest and without claiming behavior. `Verify the current native test suite` retains the full provenance + behavior + runtime-closure contract. On DATA, explicit provenance took 670.5 ms; the verifier change then correctly forced one full 57-test execution, followed by 663.4 ms warm reuse.

### Tool-specific pitfalls

- `indro proof-plan` requires proof names and a state JSON file. Use `--graph graph.json` for a bounded domain claim graph (`{"claim":{"deps":[],"inputs":[]}}`) instead of creating another planner. It computes the dependency-aware proof delta; adapters still own execution and current-state acquisition.
- `convergence_gauntlet_node.mjs` requires four positional paths; invoke `python packages/indro/tools/convergence_gauntlet.py --self-test` instead. The November 8, 2026 self-test passed, but it is not production integration proof.
- `indro work compare` compares file bytes or top-level directory entries only; it does not recursively establish behavior.
- On Windows, preserve visible output when using `Set-Clipboard`; verify the transferred artifact and prefer one primary artifact over copying an evidence tree.

## Reusable high-leverage sequences

### Diagnose a runtime regression

1. Record current identity and dirty state.
2. Search history/evidence for the same behavioral contract and known-good identity.
3. Reproduce with the smallest deterministic command stream.
4. Compare the first divergent state, not the final failure dump.
5. Trace only the source boundary owning that field.
6. Make the smallest intervention; run focused test, matched evidence, then broader suite.
7. Add a causal note here only if it prevents future rediscovery.

### Validate an optimization

1. Create same-binary opt-out baseline.
2. Interleave fresh baseline/candidate trials after warm-up.
3. Record median/p95/worst, component CPU, GPU, draws, primitives, objects, memory.
4. Capture matched decision-state images and behavior/state parity.
5. Run a post-settling soak for persistent-resource changes.
6. Reject gains that shift unacceptable cost to worst-frame, GPU, primitives, memory, or fidelity.

### Verify repository authority cheaply

Use `indro run --objective "Verify current repository state."` when the claim is the current Git HEAD, branch, and dirty-state bytes. The repository adapter performs one live porcelain-v2 status acquisition, then reuses only evidence whose exact status fingerprint and retained output still match. It does not establish runtime behavior or remote freshness. Observed warm evidence validation was 45.2 ms; the full warm CLI path was 258.2 ms, dominated by project/history acquisition.

## Persistent authorities and retention

- `AGENTS.md`: permanent safety, ownership, and required workflow.
- `TIPSANDTRICKS.md`: compact verified shortcuts, causal rules, and decision paths.
- Git: source/change history; current worktree remains authoritative.
- CommandHUD/INDRO: execution history and immutable evidence.
- Detailed reports stay with their evidence; this guide keeps only the smallest reusable conclusion and pointer.

After a meaningful investigation: search this file, confirm the observed result, update/consolidate the smallest relevant entry, and remove or qualify contradicted advice. Current runtime evidence overrides previously verified knowledge.

## GPU layout, rendered parity, and inactive work

Historical evidence: data-game/evidence/performance/GGG-PERF-004.md and GGG-PERF-005.md.

- GPU layout is a runtime contract. CPU round-trip checks passed with a malformed 16-byte vertex stream; Godot required 20 bytes including the tangent word. Assert runtime-reported strides and offsets.
- Rendered parity overrides performance gains. The malformed all-target candidate produced faceting. Dynamic tangents restored visual parity but regressed performance; fixed valid tangents preserved parity without unnecessary computation.
- Eliminate inactive work at its owning boundary. The fixture had nine live targets but generated geometry for 32 slots. Skip dead-slot geometry while preserving state, visibility, death, and reuse synchronization.
- Preserve matched controls. DB_DISABLE_PACKED_ENEMIES=1 restored reconstruction. Historical dead-skip A/B: frame median 8.175 to 4.607 ms; p95 8.733 to 5.263 ms.
- Retain rejected evidence. GGG-PERF-005 superseded the original visual acceptance in GGG-PERF-004.
