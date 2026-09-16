function boundedStrings(values, limit = 5, width = 240) {
  return (Array.isArray(values) ? values : []).slice(0, limit).map((value) => String(value).slice(0, width));
}

function commandText(record) {
  return record.operation?.displayCommand || record.operation?.command || record.command || '';
}

function semanticFacts(record) {
  const operation = record.operation || {};
  const facts = {};
  if (record.delta?.paths?.length) facts.changedPaths = [...record.delta.paths];
  if (Number.isInteger(operation.matchCount)) facts.matchCount = operation.matchCount;
  if (Number.isInteger(operation.fileCount)) facts.fileCount = operation.fileCount;
  if (Number.isInteger(operation.diagnosticCount)) facts.diagnosticCount = operation.diagnosticCount;
  if (operation.cwdPersistence) facts.cwdPersistence = operation.cwdPersistence;
  return facts;
}

function evidenceReference(record, stream) {
  const path = record[`${stream}Path`] || null;
  const evidence = record.evidence?.[stream] || {};
  return { path, bytes: evidence.bytes ?? null, sha256: evidence.sha256 ?? null };
}

export function projectRunToConversation(record) {
  if (!record?.id) throw new Error('Conversation projection requires an authoritative run record.');
  const operation = record.operation || {};
  const command = {
    id: `command:${record.id}`, kind: 'command', runId: record.id,
    timestamp: record.startedAt || null,
    content: {
      command: commandText(record), cwd: operation.cwdBefore || record.cwd || record.root || null,
      provider: operation.shell || null, source: record.provenance?.origin || null,
    },
  };
  const result = {
    id: `result:${record.id}`, kind: 'result', runId: record.id,
    timestamp: record.endedAt || record.startedAt || null,
    content: {
      status: record.status, exitCode: record.exitCode ?? null, durationMs: record.durationMs ?? null,
      operation: operation.type || null,
      summary: boundedStrings(operation.summary?.length ? operation.summary : record.reduction?.summary),
      cwdBefore: operation.cwdBefore || record.cwd || null, cwdAfter: operation.cwdAfter || null,
      provider: operation.shell || null, semanticFacts: semanticFacts(record),
    },
    evidence: { stdout: evidenceReference(record, 'stdout'), stderr: evidenceReference(record, 'stderr') },
    capabilities: {
      canViewRaw: Boolean(record.stdoutPath || record.stderrPath),
      canInspectEvidence: Boolean(record.stdoutPath || record.stderrPath),
      canUndo: Boolean(record.delta?.patchPath && record.delta?.paths?.length), canCancel: false,
    },
  };
  return [command, result];
}

export function projectRunsToConversation(runs, { limit = 50 } = {}) {
  const bounded = Math.max(1, Math.min(100, Number(limit) || 50));
  return [...(runs || [])]
    .filter((record) => record?.id)
    .sort((left, right) => String(left.startedAt || '').localeCompare(String(right.startedAt || '')) || String(left.id).localeCompare(String(right.id)))
    .slice(-bounded)
    .flatMap(projectRunToConversation);
}

export function projectActiveExecution(execution) {
  if (!execution) return [];
  const exchangeId = execution.runId || execution.id;
  return [
    {
      id: `command:${exchangeId}`, kind: 'command', runId: execution.runId || null,
      timestamp: execution.startedAt || null,
      content: { command: execution.input, cwd: execution.cwd || null, provider: execution.provider || null, source: execution.source || null },
      ephemeral: !execution.runId,
    },
    {
      id: `result:${exchangeId}`, kind: 'result', runId: execution.runId || null,
      timestamp: execution.startedAt || null,
      content: { status: 'running', exitCode: null, durationMs: null, operation: 'terminal-command', summary: [], cwdBefore: execution.cwd || null, cwdAfter: null, provider: execution.provider || null, semanticFacts: {} },
      evidence: {
        stdout: { path: execution.stdoutPath || null, bytes: null, sha256: null },
        stderr: { path: execution.stderrPath || null, bytes: null, sha256: null },
      },
      capabilities: { canViewRaw: Boolean(execution.stdoutPath || execution.stderrPath), canInspectEvidence: Boolean(execution.stdoutPath || execution.stderrPath), canUndo: false, canCancel: execution.canCancel !== false },
      ephemeral: true,
    },
  ];
}

export function projectBuiltinExchange({ command, result, startedAt, completedAt, cwd = null, provider = null }) {
  const id = `builtin:${startedAt || 'ephemeral'}:${String(command)}`;
  return [
    { id: `command:${id}`, kind: 'command', runId: result?.record?.id || null, timestamp: startedAt || null, content: { command, cwd, provider, source: 'builtin' }, ephemeral: !result?.record },
    result?.record
      ? projectRunToConversation(result.record)[1]
      : { id: `result:${id}`, kind: result?.name === 'cwd' || result?.name === 'shell' ? 'notice' : 'result', runId: null, timestamp: completedAt || startedAt || null, content: { status: 'complete', operation: `builtin:${result?.name || 'unknown'}`, summary: boundedStrings(result?.text ? [result.text] : []), cwdAfter: result?.name === 'cwd' ? result.text : null, provider: result?.provider?.id || provider }, evidence: null, capabilities: { canViewRaw: false, canInspectEvidence: false, canUndo: false, canCancel: false }, ephemeral: true },
  ];
}

export function buildConversation({ runs = [], session = null, limit = 50 } = {}) {
  const completed = projectRunsToConversation(runs, { limit });
  const active = projectActiveExecution(session?.executionView?.() || session?.activeExecution || null);
  if (!active.length) return completed;
  const activeRunId = active[0].runId;
  return activeRunId && completed.some((item) => item.runId === activeRunId) ? completed : [...completed, ...active];
}
