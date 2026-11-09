import { listRuns, resolveProject } from '../commandhud/core.mjs';
import { discoverGodotReplayWorkflow } from './godot-replay.mjs';
import { discoverNativeVerificationWorkflow } from './native-verify.mjs';

export function selectWorkflowCandidate(candidates) {
  return candidates.filter(Boolean).sort((left, right) =>
    right.confidence - left.confidence || left.expectedCostMs - right.expectedCostMs || String(right.evidenceId).localeCompare(String(left.evidenceId)))[0] || null;
}

export async function resolveObjective(objective, dependencies = {}) {
  const selectionStarted = performance.now();
  const project = await (dependencies.resolveProject || resolveProject)({ root: dependencies.projectRoot || process.cwd() });
  const records = dependencies.records || (dependencies.listRuns || listRuns)(project, dependencies.searchLimit || 1000);
  const candidates = dependencies.candidates || [
    await (dependencies.discoverGodot || discoverGodotReplayWorkflow)(objective, { ...dependencies, projectRoot: project.root, records }),
    (dependencies.discoverNative || discoverNativeVerificationWorkflow)(objective, { projectRoot: project.root, records }),
  ];
  const selected = selectWorkflowCandidate(candidates);
  if (!selected) throw new Error(`No eligible verified workflow matches objective: ${objective}`);
  const selectionMs = performance.now() - selectionStarted;
  const executionStarted = performance.now();
  const result = await selected.execute();
  return { objective, workflow: selected.id, evidenceId: selected.evidenceId, selectionMs, executionMs: performance.now() - executionStarted, result, render: selected.render };
}

export async function runObjectiveCli(objective) {
  try {
    const resolution = await resolveObjective(objective);
    console.log(`INDRO_OBJECTIVE PASS workflow=${resolution.workflow} selected_evidence=${resolution.evidenceId} selection_ms=${resolution.selectionMs.toFixed(1)} execution_ms=${resolution.executionMs.toFixed(1)}`);
    resolution.render?.(resolution.result);
    return 0;
  } catch (error) {
    console.error(`INDRO_OBJECTIVE FAIL ${error.message}`);
    return 1;
  }
}
