# INDRO simplification and evidence gates

This document defines decisions to resolve architectural complexity, not claims of measured improvements.

## 1. Canonical authority

- `packages/commandhud` owns execution, retained evidence, run identity, proof and undo.
- `packages/indro` owns language parsing and workflow-plan compilation, not a second execution/evidence implementation.
- `packages/digitalbreakdown-terminal` is an optional client. It must not become another source of execution truth.
- Terminal visual effects must never be required for CLI correctness. A plain terminal is the baseline.

## 2. Custom language: keep only if it adds value

Compare a representative INDRO workflow against PowerShell/Python and a declarative JSON equivalent. Measure authoring complexity, repeatability, auditability, portability, and failure handling. Avoid introducing language features without a task demonstrating an advantage. Prefer emitting existing CommandHUD operations over implementing a parallel runtime.

## 3. NDRA and mathematical claims

NDRA can prove properties only within its declared bounded model, transition semantics and enumerated assumptions. Distinguish exact bounded results from unbounded conjectures. Require deterministic replay and counterexamples where a property fails. No general complexity-theory claims from bounded success.

## 4. Agent orchestration overhead

For each retained operation, measure execution wall time, evidence storage bytes, context packet bytes, handoff recovery time, and extra tool calls. Keep a plain-command path. Do not add a new orchestration layer without evidence that it improves a real task.

## 5. Repository intelligence benchmark

- Use at least 20 historical tasks across more than one repository and task category.
- Reconstruct the repository at the commit before each task. Do not read target changes during ranking.
- Compare `rg`/Git baseline, lexical ranking, dependency-graph ranking and agent-assisted discovery.
- Separate existing changed-file recall from prediction of newly created files.
- Report Recall@K, Precision@K, first-relevant rank, time, tool calls and token use when available.
- One task with a target ranked third is a smoke test, not proof of improvement.
- Do not tune on the held-out evaluation tasks.

## 6. Clipboard safety

- OSC 52 is opt-in using `HUD_OSC52=1` in an interactive SSH TTY.
- Limit payloads to 32768 UTF-8 bytes and reject empty output.
- A successfully written OSC 52 escape sequence means sent, not clipboard receipt confirmed.
- Never infer receipt from an exit status; verify by pasting at the receiving terminal.
- Keep native clipboard transport for non-SSH and non-TTY sessions.
- Consider sensitive evidence before enabling automatic clipboard writes.

## Acceptance criteria

An issue is *fixed* only after its implementation passes existing tests and its own focused regression tests. An architectural hypothesis is *validated* only after a reproducible comparison with an appropriate baseline. Do not replace either with documentation or passing smoke tests.
