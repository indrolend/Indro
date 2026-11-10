import { listRuns, resolveProject } from '../commandhud/core.mjs';
import { discoverGodotReplayWorkflow, recognizesGodotReplayObjective } from './godot-replay.mjs';
import { discoverNativeVerificationWorkflow, recognizesNativeVerificationObjective } from './native-verify.mjs';
import { discoverRepositoryStateWorkflow, recognizesRepositoryStateObjective } from './repository-state.mjs';

export function selectWorkflowCandidate(candidates) {
  return candidates.filter(Boolean).sort((left, right) =>
    right.confidence - left.confidence || left.expectedCostMs - right.expectedCostMs || String(right.evidenceId).localeCompare(String(left.evidenceId)))[0] || null;
}

function historyWindows(limit) {
  return [...new Set([10, 100, limit].map((value) => Math.min(value, limit)).filter((value) => value > 0))].sort((a, b) => a - b);
}

async function discoverFromHistory(objective, project, dependencies) {
  const discoverGodot = dependencies.discoverGodot || discoverGodotReplayWorkflow;
  const discoverNative = dependencies.discoverNative || discoverNativeVerificationWorkflow;
  const discoverRepository = dependencies.discoverRepository || discoverRepositoryStateWorkflow;
  const suppliedRecords = dependencies.records;
  if (suppliedRecords) return [
    await discoverGodot(objective, { ...dependencies, projectRoot: project.root, records: suppliedRecords }),
    discoverNative(objective, { projectRoot: project.root, records: suppliedRecords }),
    discoverRepository(objective, { ...dependencies, project, projectRoot: project.root, records: suppliedRecords }),
  ];

  const customDiscovery = dependencies.discoverGodot || dependencies.discoverNative || dependencies.discoverRepository;
  const needsGodot = customDiscovery || recognizesGodotReplayObjective(objective);
  const needsNative = customDiscovery || recognizesNativeVerificationObjective(objective);
  const needsRepository = customDiscovery || recognizesRepositoryStateObjective(objective);
  if (!needsGodot && !needsNative && !needsRepository) return [];

  const list = dependencies.listRuns || listRuns;
  const limit = dependencies.searchLimit || 1000;
  let candidates = [];
  for (const window of historyWindows(limit)) {
    const records = list(project, window);
    candidates = [
      needsGodot ? await discoverGodot(objective, { ...dependencies, projectRoot: project.root, records }) : null,
      needsNative ? discoverNative(objective, { projectRoot: project.root, records }) : null,
      needsRepository ? discoverRepository(objective, { ...dependencies, project, projectRoot: project.root, records }) : null,
    ];
    if ((!needsGodot || candidates[0]) && (!needsNative || candidates[1]) && (!needsRepository || candidates[2])) break;
    if (records.length < window) break;
  }
  return candidates;
}

export async function resolveObjective(objective, dependencies = {}) {
  const selectionStarted = performance.now();
  const project = await (dependencies.resolveProject || resolveProject)({ root: dependencies.projectRoot || process.cwd() });
  const candidates = dependencies.candidates || await discoverFromHistory(objective, project, dependencies);
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
