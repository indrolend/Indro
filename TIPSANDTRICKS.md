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

### Retain a product capability ledger

When a product experiment emits `capability.ledger/v1`, retain it through the existing capability authority:

```powershell
indro capability retain-ledger --ledger <capability-ledger.json> --json
indro capability validate evidence.<capability-id> --json
```

The ledger must contain `capability.observation/v1` records that separate requested, effective, observed, verdict, and cost. Its complete evidence bundle must be covered by a SHA-256 manifest, including the ledger itself. Validation rejects schema mismatch, path escape, missing evidence, changed bytes, or changed digests. This makes the compact claims reusable only while their underlying evidence remains intact; it does not upgrade renderer activation into a visual-quality judgment.

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
- **Never create a new harness, abstraction, checklist, or evidence warehouse when an existing INDRO command, adapter, experiment, test, capture funnel, or historical artifact can answer the question.**
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


## Proven multistep workflows: remote control, applications, and artifact handoff

The sequences below consolidate observed user sessions, retained INDRO source contracts, and successful operational transcripts. Their status is explicit: **verified** means a concrete run or readback was observed; **documented** means the remote repository defines the interface but this guide does not claim a fresh live end-to-end run; **fallback** means use only when the preferred path is unavailable.

### Cross-device control and remote work

**Use when:** supervising the Windows home workstation from iPhone/macOS/ChatGPT, running a bounded remote task, or retrieving its output.

1. Prefer the authenticated, typed INDRO/CommandHUD connector operations for normal remote work. They address the same local authority as the private iPhone SSH route; do not create a second job or evidence authority.
2. Identify the registered project and exact Git HEAD. Start an isolated job against that exact HEAD; retain the returned job identity.
3. Use typed lifecycle operations to list/get/request-stop jobs. Do not pass arbitrary shell strings, filesystem paths, PIDs, credentials, or packet bodies through the remote executor.
4. Let CommandHUD own execution, provider worker lifecycle, Git/worktree identity, cancellation, immutable evidence, and recovery.
5. Use Brokeman only as a continuity projection: compact checkpoint, semantic state, provider outcome, handoff packet, and artifact descriptor. It must not become a second executor or evidence store.
6. Retrieve packet bytes from the Windows workstation through the documented SFTP/native-file path. Use ntfy for attention/notification only, never as a command or artifact transport.
7. Use Termius/Tailscale SSH as the general shell/OS escape hatch when typed operations cannot express the required task. Keep SSH transport separate from job/evidence ownership.
8. On the home runtime, use CommandHudHomeControl.ps1 status|start|stop|restart as the operator surface. The scheduled task is transport/runtime plumbing, not the owner of jobs or Git state.

**Authority and security boundary:** the documented home executor remains bound to loopback behind its authenticated tunnel. Bearer values are read from Windows Credential Manager and inherited by child processes; do not place them in command lines, configuration, logs, packets, or repository state. Remote operations should be scoped to project IDs, exact HEADs, job IDs, bounded objectives, and literal actions.

**Status:** remote-control architecture and operator contract documented in docs/MOBILE-REMOTE-CONTROL.md; do not claim that a given connector operation is currently connected or available until its live status is observed.

### Remote Windows terminal and GUI evidence

**Use when:** an SSH/WSL task needs evidence from the logged-in Windows desktop session rather than a headless shell.

1. First attempt a normal bounded command or headless capture if that satisfies the claim.
2. Do not assume an SSH/WSL process owns an interactive desktop. A screenshot attempt from that context previously failed with "The handle is invalid".
3. When a real interactive desktop frame is required, use the existing interactive Task Scheduler route (CommandHUD-EvidenceCapture) under the logged-in session. The verified PowerShell executable was $env:LOCALAPPDATA\Microsoft\WindowsApps\pwsh.exe.
4. Trigger the task, then inspect its completion result and session marker. The observed successful receipt was LastTaskResult: 0 and SUCCESS SESSION=1.
5. Only then consume the produced image. Preserve the task result and screenshot together in the evidence packet.

**Status:** verified Windows session-1 screenshot capture. This is a GUI-evidence fallback, not the default command-execution mechanism. Do not report a screenshot as successful merely because the scheduled task was triggered.

### Chrome hijack investigation and persistence diagnosis

**Use when:** Chrome search/new-tab behavior is hijacked, including after reinstall or apparent cleanup.

1. Identify the affected Windows machine and exact Chrome profile. Close every Chrome process before inspecting or modifying profile databases.
2. Preserve a timestamped before-state snapshot of the profile's relevant Preferences, Secure Preferences, and Web Data database. Keep evidence outside the live profile.
3. Inspect the configured default search provider and new-tab URL in both JSON preference stores. Compare the mirrored/secure values; do not assume one file is authoritative by itself.
4. Query the keywords table in Web Data and identify active search-provider rows whose new_tab_url or related fields point to the unwanted domain. Record row IDs, names, keywords, active flags, and URL fields.
5. Correlate the database rows with JSON preferences. Do not delete a legitimate Google provider merely because another provider has a similar name or keyword.
6. Make the narrowest targeted repair only after the browser is closed and a backup exists. Preserve the original database and before/after evidence.
7. Relaunch Chrome normally. Inspect both JSON stores and the SQLite rows again after launch; then close Chrome normally and inspect once more. A database that looks clean before launch can be repopulated by a still-active preference, policy, extension, or process.
8. If the unwanted URL returns, identify the component that rewrites it before repeating the same database edit. Reinstalling Chrome alone is not a diagnosis.
9. Record process counts and extension/policy evidence where they discriminate competing causes. Avoid dumping unrelated profile data or secrets.

**Verified case:** joblikedrumscool.com/nt persisted after reinstall and was present in Chrome's JSON preferences and SQLite keyword rows. A direct SQLite cleanup made the targeted rows clean, but Chrome preferences were still hijacked after launch in one trial; a later profile trial identified a malicious google keyword row despite a separate clean goog row. The durable lesson is to verify after normal launch and normal exit, not just immediately after editing Web Data.

### FL Studio bridge: inspect first, mutate with readback

**Use when:** controlling mixer/plugin parameters, diagnosing the Granulizer bridge, or resuming an audio automation task.

1. Run indro fl doctor --json and inspect the live bridge schema/version, session ID, process ID, heartbeat age, and connection status. A session.json file alone does not prove a live host.
2. Discover actual targets with indro fl channels list --json and indro fl plugins list --json. Inspect the chosen channel with indro fl plugin inspect --channel N --json.
3. Enumerate the real parameter contract using indro fl plugin params --channel N --json; read the current value with indro fl plugin get --channel N --param N --json.
4. Before writing, confirm the channel/plugin/session identity. Do not infer a channel number from a UI label or reuse a stale process/session snapshot.
5. Make a write only when the exact capability exists and the user has authorized it: indro fl plugin set --channel N --param N --value 0..1 --verify --json.
6. The adapter reads the parameter before invocation and again afterward, compares the readback with the caller's expected value (tolerance 0.002 in the current FL CLI), and persists a transaction receipt.
7. Verify with indro fl verify --latest --json. Distinguish STATE_CONFIRMED from an independently audible effect: the current FL receipt explicitly says host scripting API readback does not establish that the change was heard.
8. If an operation is unsupported, a bridge schema differs, a heartbeat is stale, or a target identity fails validation, stop and repair/discover the contract. Do not bypass the adapter with guessed mailbox JSON or UI keystrokes.

**Verified interface:** doctor, status, channel/plugin listing, inspect, params, get, set-with-readback, transport status, and latest-receipt validation are implemented in packages/indro/fl/cli.mjs. The bridge mailbox is transport; FL Studio remains the state authority. A timeout after submission is outcome-unknown, not proof that the host did nothing.

### UAI transaction pattern for controlling any application

**Use when:** adding or using an application control that must be safe, attributable, and verifiable.

1. Identify the application instance/session and exact target (not merely its display name).
2. Discover the capability and its adapter. Confirm it is invocable and connected to the live application, not just present in a manifest or fixture.
3. Observe and record pre-state through the adapter.
4. Require explicit write authorization for mutations. Keep read-only observation separate from writes.
5. Submit one operation with a unique transaction ID.
6. Record milestones separately: SUBMITTED, RECEIVED, ACCEPTED, EXECUTED, STATE_CONFIRMED, EFFECT_VERIFIED. Unknown stays UNKNOWN; never promote a lower milestone into a higher one.
7. Read back state from the application's authority and compare it against the caller's expected postcondition.
8. Independently verify external effect when the task requires it (for example, audible output or actual rendered behavior).
9. Persist the receipt and its limitations. A checksum is integrity metadata, not authenticated provenance; transaction state confirmation is not effect verification.
10. Treat timeout after invocation as TRANSPORT_UNKNOWN; inspect the operation/host state before retrying to avoid duplicate actions.

**Status:** the UAI transaction kernel and offline fixture are implemented. The fixture only mutates in-memory test state; it does not control FL Studio or another live application. The FL adapter is a concrete live example with host readback. See packages/indro/uai/README.md and packages/indro/uai/transaction.mjs.

### Audio loopback capture and troubleshooting

**Use when:** recording desktop playback, diagnosing FL Studio monitoring/latency, or producing a reproducible WAV.

1. Enumerate actual capture devices and endpoint names before selecting one. Do not assume WASAPI is available because Windows exposes an audio endpoint.
2. Probe the intended FFmpeg input backend and exact device name. Record the error if the backend is unavailable; do not silently substitute a microphone input.
3. A verified fallback on the Windows workstation used Python soundcard loopback against the actual default speaker endpoint (Speakers (2- Focusrite USB Audio)), producing a WAV on the Desktop.
4. Confirm the capture file exists and has nonzero size; inspect duration/sample rate/channels and listen to a short segment before treating it as a successful recording.
5. For latency/sync problems, compare the live input path, selected FL audio device, buffer settings, plugin chain, and recorded loopback. Change one variable at a time and verify the playhead/audio alignment over time.
6. Keep source audio, loopback capture, and processed render distinct. A successful file write does not prove the intended signal was captured.

**Status:** loopback capture through Python soundcard was observed working; WASAPI was unavailable in the tested FFmpeg setup. Do not assume that exact endpoint remains the default on another machine/session.

### Artifact handoff and clipboard semantics

**Use when:** transferring screenshots, recordings, GIFs, ZIPs, or replay evidence into ChatGPT or another application.

1. Prefer one primary artifact or a compact evidence packet, not a directory dump.
2. Verify the artifact exists, has plausible size, and matches the intended type. For evidence packets, verify manifest contents and hashes.
3. Choose the clipboard contract deliberately:
   - Text receipt: PowerShell Set-Clipboard / macOS pbcopy.
   - Actual file object: Windows file-drop clipboard; a path string is not a file object.
   - Actual image: image clipboard; a path string or PNG bytes as text is not an image clipboard.
4. INDRO's Godot replay supports --clipboard for a verified file-drop list containing the replay ZIP and --clipboard-image for the final captured image. Its implementation reads the clipboard back and checks the transferred item before reporting confirmation.
5. After transfer, report exactly what was copied (text, file object, or image) and the verified artifact path. Never claim file-object copy based on Set-Clipboard $path.
6. Keep the visible terminal receipt and copy the concise result automatically. If the OS clipboard is isolated by a remote/browser automation environment, say so rather than claiming an end-to-end clipboard round trip.

### PowerShell transcript and evidence packet

**Use when:** a multi-step session needs a reproducible handoff to ChatGPT/Codex or another machine.

1. Capture the real terminal session with PowerShell transcription when a transcript is needed. Do not reconstruct a transcript from memory and label it canonical.
2. Keep CommandHUD's immutable run record as the execution authority: command, cwd/project, exit status, duration, stdout/stderr, before/after Git identity, and evidence references.
3. Add reasoning annotations as a separate derived layer. Clearly distinguish observed terminal output, assistant/user interpretation, hypotheses, and proposed next actions.
4. Build a handoff from the exact relevant source files, tests, receipts, logs, and artifact manifest. Preserve original evidence; do not replace it with a summary.
5. Include repository root, branch, HEAD, upstream/divergence, dirty counts, test outcomes, evidence IDs, and unresolved questions. State whether each claim is verified, inferred, or untested.
6. ZIP only the bounded packet. Verify file count, byte count, archive integrity, and SHA-256; copy the actual ZIP file object when feasible.
7. For remote packet retrieval, return a descriptor and fetch the bytes through the approved file-transfer path. Do not embed large binary/Base64 payloads in chat or notification messages.

**Status:** PowerShell transcript capture, annotated transcript generation, and a 20-file INDRO/Codex packet (324,501 bytes) were observed in prior work. The packet's SHA-256 was recorded. These are proven handoff patterns; exact automation flags should still be discovered from current CLI help.

### Printer and peripheral troubleshooting

**Use when:** a printer reports an error, jobs are retained, or the physical device appears idle.

1. Observe device status, queue count, and each job's ID/status before restarting services or deleting jobs.
2. Use a device-local action (such as the feed button) to test the mechanical path independently of the application/spooler.
3. Re-read printer status and queue after the physical test. A normal device with a cleared queue narrows the fault but does not prove the business application printed successfully.
4. Test the actual application workflow only after the device path is known good. Do not infer undocumented semantics from a checkbox such as Test mode; consult the application's own documentation or support.
5. Preserve the job ID/status and exact application outcome when escalating.

**Verified case:** DYMO LabelWriter 450 on USB003 recovered to PrinterStatus=Normal, JobCount=0 after a feed-button test advanced multiple labels. PostalMate Quick Postage/postmark behavior remained unverified; the Test mode checkbox was not interpreted as proof of a real postmark.

### Historical game variants and compatible-build recovery

**Use when:** recovering a mature implementation or comparing dramatically different playable versions.

1. Start from remote main and its exact local correspondence; record commit, branch, ancestry/divergence, and the current dirty worktree separately.
2. Search remote branches/commits by gameplay subsystem and inspect commit messages plus changed gameplay/test files. Rank candidates by distinct playable behavior and proof coverage, not raw commit count.
3. Identify branch-unique commits and shared ancestry. Group candidates by coherent gameplay phenotype (for example physical enemy locomotion, zombie pursuit, herd support, articulated motor, or presentation experiments).
4. Check compatibility at file and API boundaries before combining changes. Overlap in CMakeLists.txt, desktop/main.cpp, shared simulation state, or renderer files requires explicit reconciliation.
5. Build each candidate in an isolated worktree/build directory. Never overwrite the active dirty integration worktree to test a historical branch.
6. Verify its own focused tests and launch it. Capture matched gameplay evidence using the same scenario/camera/seed where possible.
7. Preserve distinct working builds as comparison candidates until a measured, playable convergence decision is made. Do not prematurely merge the most different versions into one branch.

**Observed candidate families:** convergence/zombie-v1, codex/extreme-enemy-lab, codex/specification-convergence-pass3, prototype/physical-enemies, integration/mature-enemy-motor, experiment/endorphin-enemy-physics, and experiment/visual-ablation-control. Their historical branch names and commit counts are discovery leads, not proof that each branch still builds against the current toolchain.

### INDRO capability expansion by dogfooding

**Use when:** deciding whether a repeated manual workflow deserves a reusable INDRO capability.

1. Find at least two real executions/transcripts of the same operational pattern. Extract input, target identity, state observations, mutation, postcondition, failure modes, and evidence.
2. Separate stable invariants from application-specific details. Do not generalize from one accidental sequence.
3. Inspect the current public CLI, adapters, manifests, tests, and live application interface before designing anything.
4. Prototype the smallest adapter against a fixture, then a disposable real target where safe. Keep the fixture's scope explicit; it cannot prove live connectivity.
5. Make target discovery and read-only observation work before enabling writes.
6. Require per-operation authorization, explicit expected postconditions, readback, bounded timeouts, and honest unknown outcomes.
7. Record a receipt that distinguishes submitted/received/accepted/executed/state-confirmed/effect-verified.
8. Add a regression test for the exact failure or ambiguity that motivated the capability.
9. Measure interaction count, latency, failure rate, and recovery cost against the original manual workflow. Keep the capability only if it saves future effort without weakening authority or evidence.
10. Add the compact verified procedure here and keep detailed transcripts/evidence with their owning project.

**Generalization rule:** INDRO should learn the recurring control contract (discover → observe → authorize → invoke → read back → verify effect → retain), not accumulate a warehouse of one-off application scripts.


### Persistent CommandHUD terminal: everyday command-and-context loop

**Use when:** performing repeated repository work where command results need to return to ChatGPT/Codex without manual selection.

1. From the intended repository, launch hud shell (plain line-oriented interface) or hud tui (fixed terminal interface). Both use the same CommandHUD execution/evidence core; the visual client is not a separate authority.
2. Paste ordinary PowerShell/shell commands directly. The shell retains repository-contained cwd changes between commands, executes against the real repository, records immutable evidence, shows a condensed result, and automatically copies the same ChatGPT-ready context while retaining full stdout/stderr.
3. Use slash commands to inspect the retained run without rerunning it: /history [n], /head [run] [count], /tail [run] [count], /find [run] pattern, /around [run] pattern [lines], /raw [run], and /diff run run.
4. Use /copy for the current compact projection, /context for context, /cwd to inspect working directory, /shell to inspect/select shell, and /exit to leave. Use /undo only after reviewing its preview; undo is evidence-backed and preview-first.
5. Prefer bounded /head, /tail, /find, /around, and /diff over copying the full raw transcript. Request /raw only when the complete stream is genuinely needed.
6. Use hud proof <repository-command> or /proof <repository-command> to look up a retained successful proof against current repository bytes. Proof lookup does not execute the command and does not itself authorize skipping work.
7. Use Copy handoff / hud packet --copy when moving the result into a normal chat-to-terminal loop. The bounded handoff contains repository/branch/cwd, explicit shell, exact command, truthful status/exit code, changed paths, bounded output tails, and the immutable raw-run reference.

**Important:** the ordinary shell is the simplest default. Use the TUI only when its fixed layout/focus controls materially help. The standalone browser renderer is a secondary client and cannot claim repository state without its live local runtime.

**Status:** implemented and documented in packages/commandhud/README.md. The live browser copy-dock test verified selection, copy status, and paste behavior, but OS clipboard byte-for-byte round-trip from the isolated browser automation was explicitly unverified. The shell's own clipboard path and immutable evidence contract are distinct from that browser test.

### Tailscale + SSH + WSL + tmux: remote development fallback

**Use when:** controlling the home Windows machine from another trusted device and continuing a long-lived Linux development shell.

1. Check the current Tailscale peer state and resolve the intended machine before connecting. Use the currently reported Tailscale IP/DNS name; do not assume an old IP or peer is still online.
2. SSH to the Windows OpenSSH service using the Windows account and verified peer address.
3. From the Windows session, enter the intended WSL distribution (the observed environment was Ubuntu-24.04).
4. Attach to the existing tmux session (observed name: development) rather than starting a duplicate process/session.
5. To recover bounded terminal context, use tmux capture-pane -p -S -1000. Prefer the last relevant lines over a full scrollback dump.
6. Before running commands, verify machine, repository root, branch, HEAD, and dirty state inside the actual WSL/Windows execution environment. Do not infer Linux repository state from the Windows checkout or vice versa.
7. When finished, leave the authoritative tmux session and its processes in their intended lifecycle. A prior nohup sleep 600 workaround only kept WSL alive temporarily; persistent WSL lifecycle management was not established by that experiment.

**Status:** Tailscale → SSH → Windows → WSL2 Ubuntu-24.04 → tmux was exercised. SSH/WSL is a transport and shell path, not a substitute for CommandHUD's job/evidence authority. Use the typed remote-control architecture above when it supports the operation.

### FL bridge incident: distinguish unsupported operation from bad target

**Observed failure:** the live bridge v2 did not implement mix.inspect. A fallback attempted to read arguments.channel when the operation supplied no such field, producing INVALID_CHANNEL. The requested mixer channels 5 and 6 were valid; no routing mutation occurred.

**Reusable diagnosis:**
1. Check bridge schema/version and enumerate supported operations in the deployed bridge source.
2. Confirm the exact request envelope and whether the channel is carried in target or arguments for that operation.
3. Separate UNSUPPORTED_OPERATION / malformed request from INVALID_CHANNEL / invalid target. Do not repair mixer routing when the failure is in capability dispatch.
4. Verify channel/plugin identity read-only before any write.
5. Add the missing operation only through the bridge contract and test it with a fixture plus live readback; do not silently invent fallback argument semantics.

This is a concrete reason to inspect capability contract and request schema before interpreting an application error string.
