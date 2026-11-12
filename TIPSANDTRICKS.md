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

For safe public-history experiments, reuse `packages/indro/tools/ndra_repo_gauntlet.py` and its pinned GitHub workflow before executing third-party code. The first hosted five-repository assay accounted for all 3,058 function records with zero false skips, but semantic proof reuse saved no evaluations beyond exact caching. Treat exact caching as the preferred baseline until a new corpus demonstrates additional proof-directed savings; see `docs/evidence/open-source-gauntlet-c0964ff.json`.

For any committed Git checkout, `indro run --objective "Verify current repository state."` is the established language-independent first proof. A hosted Rust/Go/JavaScript/C++ trial verified cold execution, exact warm reuse, changed-HEAD invalidation, and original-evidence reuse after restoration in every repository without executing third-party source. Use this before installing dependencies or running repository-owned code; it proves source state only. Receipt: `docs/evidence/multilanguage-repository-state-e0b816a.json`.

For an external CMake/CTest repository, first record one explicit `indro run --objective "Verify current native tests behavior." -- node <indro-cli> verify-native ... --declare-runtime-closure` invocation with every relevant runtime file named. Equivalent future objectives recover that exact workflow. The hosted fmt assay ran 22 tests, reused equivalent evidence in 365 ms versus 3,932 ms cold, rejected both HEAD transitions, and showed that rebuild time—not CTest—dominated invalidation cost. Never infer runtime closure from a passing exit alone; retain the CTest plan, environment, executable/toolchain identities, and enumerated dynamic libraries. Receipt: `docs/evidence/external-fmt-native-e0d7456.json`.

For third-party behavioral dogfooding, use the repository's own smallest stable test contract through `packages/indro/tools/external-command-assay.mjs`. Confirm the command directly before treating a nonzero result as an INDRO regression: the hosted assay found an absent Express lockfile and a nightly-only Rust benchmark target. Never attribute a cold-first direct/INDRO timing difference to INDRO; direct execution may warm compiler and test caches. Require symmetric warm-up or balanced order for a causal speed claim. The general `indro run` funnel records verified output and failure evidence but does not reuse arbitrary test results.

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


## Non-negotiable operating rules: preserve time, state, and attention

These rules capture repeated, directly observed workflow preferences and failure patterns from real INDRO, DATA-GAME, Godot, Windows, and macOS sessions. Apply them before proposing commands or interventions.

### Never do this again

- **Never give bare terminal commands when a known clipboard workflow is expected.** On Windows PowerShell, capture the complete output, preserve visible output, copy it with `Set-Clipboard -Value $result`, and print a compact `✓ copied` confirmation. On macOS, use `pbcopy` while retaining visible output. Do not confuse copying text with copying an actual file object.
- **Never claim autopaste when only autocopy is implemented.** Autocopy transfers text to the clipboard; autopaste additionally targets an input, pastes, and submits. Describe only the behavior actually implemented and verified.
- **Never run project-scoped INDRO history/search from the user's home directory or another repository.** First enter the target repository. A `No Git repository` result is a wrong working context, not evidence that history or workflows are absent.
- **Never use a broad natural-language phrase with a literal fixed-string search and interpret zero matches as absence.** Split terms, search known filenames/symbols, inspect history and evidence, and check the search implementation's matching semantics.
- **Never ask the user to run local Git commands to retrieve public remote facts available through the connected GitHub integration.** Use the connector for remote branches, commits, file contents, and comparisons; use local commands only for facts that require the actual local worktree, installed tools, process, build, or runtime.
- **Never assume a remembered path, branch, executable, build directory, or source SHA is still current.** Observe the current state first. In particular, do not substitute a guessed `data-game-current-main` path for the known project root.
- **Never modify, reset, clean, rebase, merge, cherry-pick, or overwrite a dirty worktree before identifying and preserving its unrelated changes.** Separate tracked modifications, untracked source, generated evidence, and build artifacts. Preserve the exact pre-change state.
- **Never treat a passing exit code, screenshot, build, manifest, hash, or test count as proof of a different contract.** Process completion, source provenance, artifact integrity, visual appearance, simulation behavior, and temporal continuity require distinct evidence.
- **Never infer the active runtime from source alone.** Trace source revision and dirty identity → build target/configuration → executable or loaded library → running process → observable behavior.
- **Never assume native desktop and Godot presentation share the same renderer or defect.** Identify the actual engine, renderer, executable, and build that produced the observed frame before tracing a rendering bug.
- **Never rewrite or redesign a subsystem before searching for its mature historical implementation, prior known-good behavior, existing tests, and saved evidence.** Prefer recovery and minimal causal changes over re-imagining.
- **Never let infrastructure investigation displace the user's actual goal.** For game work, get to a playable build quickly. Only investigate tooling or build infrastructure when it blocks play, verification, or a meaningful improvement.
- **Never run a multi-configuration Visual Studio CTest build without specifying its configuration.** Use `ctest --test-dir <build> -C Release ...` for Release; otherwise tests may report “Not Run” because configuration is missing. Do not misreport that as a test failure.
- **Never generalize a stack-reserve fix to every executable without evidence.** Identify which target owns large stack-resident objects and verify each affected target. The observed Windows desktop save-test failure was fixed by an 8 MiB reserve on `DigitalBreakdown`; other targets need their own evidence.
- **Never present a suspected cause as confirmed.** Label observations, hypotheses, interventions, and verified causal findings separately. A source-level suspicious pattern is not proof that it caused a rendered artifact.
- **Never create a new harness, abstraction, checklist, or evidence warehouse when an existing INDRO command, adapter, experiment, test, capture funnel, or historical artifact can answer the question.
- **Never dump the whole repository, full `indro state --json`, or hundreds of files by default.** Scope by project, filename, symbol, run count, line range, and decision relevance.
- **Never make the user repeat context already present in the current transcript, saved work, or repository evidence.** Recover it first.
- **Never silently discard failed or rejected experiments.** Retain enough provenance to understand what was tested, what failed, and why a later approach superseded it.

### Always do this

1. **Consult this guide first**, then inspect current state. Treat it as an index to proven procedures, not a substitute for live observation.
2. **Use the INDRO public interface as the single operational entrypoint.** Discover with `indro --help`, inspect implementation only when needed, and reuse existing adapters and evidence workflows. Keep domain-specific fixtures/assertions in their owning repository.
3. **Use the correct project root.** DATA-GAME history and search run from `C:\Users\indro\Projects\data-game`; INDRO development history/search runs from `C:\Users\indro\Projects\Indro`. Verify the actual root rather than assuming the current directory.
4. **Autocopy terminal results by default.** Use one compact PowerShell block, capture stdout and stderr, display the result, copy the same result with `Set-Clipboard`, then show `✓ copied`. Do not hide diagnostic output. On macOS, use the equivalent `pbcopy` pattern.
5. **Keep command interaction minimal.** Give one next command, not a speculative sequence of commands. Stop when its output determines the next decision. The user prefers concise terminal output and minimal headings.
6. **Recover workflows progressively.** Start with `indro history 10`; expand to 100 and then the documented 1,000 bound only if necessary. Search specific terms separately. Use the correct evidence identifier namespace.
7. **Before an intervention, record authority:** repository root, branch, HEAD, dirty state, relevant file hashes, build configuration, executable/library identity, and runtime identity as appropriate.
8. **For a regression, reproduce the smallest deterministic case, compare the earliest divergence, trace the owning data/control path, change one causal variable, and verify the externally meaningful contract.**
9. **For visual defects, identify the exact engine/build/source SHA and reproduce with matched scene, camera, simulation state, and settings.** Use existing visual-ablation controls to isolate light groups, shadow casters, geometry families, materials, and environment. Capture only the images/telemetry needed to discriminate hypotheses.
10. **Use extreme manipulations when the game interface supports them.** Isolate, disable, multiply, freeze, move, scale, deform, exaggerate, or replace components to expose causal interactions. Keep interventions controlled and record the exact configuration. Preserve authoritative simulation invariants when testing presentation-only changes.
11. **Treat the game as an experimental system, not only as a manual play session.** Use parameter sweeps, one-factor isolation, factorial combinations, deterministic replay, controlled actor populations, temporal sampling, and matched A/B experiments when they reduce uncertainty. Do not build an automated search framework until a small experiment proves it useful.
12. **Get to playability early.** Once a valid executable exists, launch it and let the user inspect gameplay unless a concrete blocker or high-value verification requires otherwise.
13. **For mature-build exploration, compare distinct historical branches as separate playable candidates.** Identify their unique commits, changed gameplay/test files, dependencies, and compatible combinations before integrating. Preserve the ability to build and compare materially different versions.
14. **For GitHub facts, use the connected GitHub integration.** Pin every remote file/commit comparison to explicit refs/SHAs. Keep remote truth, local worktree truth, and runtime truth distinct.
15. **For reusable verification, search history/evidence before rerunning.** Reuse only when source, build graph, environment, tools, runtime closure, inputs, and behavioral contract still match. A warm reuse result is not a fresh test execution.
16. **After an investigation, retain only the smallest verified, non-obvious, reusable causal lesson here**, with a pointer to detailed evidence. Consolidate duplicates and qualify or remove advice contradicted by newer observations.

### Personal workflow defaults

- The user works primarily on a Windows PC with PowerShell 7.6.9 for DATA-GAME/INDRO tasks; macOS is also used. Prefer Windows commands when the active terminal is PowerShell, and never assume the shell from an old transcript.
- Windows terminal output should normally be automatically copied as text while remaining visible. Use `Set-Clipboard`; do not use Windows Forms clipboard APIs. A pathname copied as text is not the file itself.
- For actual artifacts (PNG, WAV, GIF, ZIP, video, etc.), distinguish the actual file-object clipboard operation from copying its path or text. Do not claim the artifact itself was copied unless that operation was verified.
- Prefer one short, copy-pasteable command block, filtered output, and a single next action. Avoid long progress narration and unsolicited menus.
- The user wants to play and improve Digital Breakdown, recover mature implementations, compare radically different compatible builds, and use INDRO to make experimental development cheaper and more powerful. Tooling is valuable insofar as it advances those goals.
- Reuse the existing game and INDRO interfaces aggressively: replay, deterministic input, evidence reuse, telemetry, visual ablation, runtime capture, and historical branch inspection. Discover exact invocation from help/history/source rather than inventing flags.
- Preserve known-good gameplay and working behavior across builds. Small presentation or subsystem changes must not silently remove unrelated simultaneous behaviors, controls, animation, persistence, or visual features.
- Keep evidence transparent and compact: text when sufficient; a single useful artifact or bounded evidence packet when necessary. Avoid junk output and duplicate artifacts.
- Treat user-reported observations as evidence to investigate, not permission to jump to a diagnosis. The user explicitly values archaeology, persistence, and preventing repeated rediscovery.

### Current case note: shadow staining

The reported symptom is screen-wide visual staining when shadows are enabled. The source-level inspection at the reported build identified broad shadow toggles and transparent presentation geometry as candidate interactions, but did **not** establish a visually confirmed cause. Reuse the existing Godot visual-ablation experiment and isolate light groups/caster families on the exact runtime build. Do not change material appearance, lighting energy, geometry, or simulation together. Update this note only after a controlled intervention establishes the causal source.
