import {
  buildCurrentOperationContext, diffRunEvidence, formatRepositoryCommandProof, lastRun, listRuns,
  projectRunEvidence, repositoryCommandProof, runById, undoOperation, undoPlan,
} from './core.mjs';

export function shellHelp() {
  return [
    '/copy [run]    copy compact context for the latest or selected run',
    '/context [run] print compact context for the latest or selected run',
    '/raw           print complete stdout and stderr',
    '/head [n]      show the first recorded lines without rerunning',
    '/tail [n]      show the last recorded lines without rerunning',
    '/find <text>   find literal text in recorded evidence',
    '/around <text> [n]  show recorded lines around matches',
    '/diff <run> <run>  compare two retained stdout/stderr records',
    'Add a run ID after the command to inspect an older run.',
    '/history [n]   list a bounded number of recorded operations',
    '/proof <name>  reuse current repository-command evidence without executing',
    '/undo          inspect the latest command for safe Undo',
    '/undo <run>    apply a previously inspected safe Undo',
    '/shell <id>    switch to powershell, bash, or cmd',
    '/cwd           show the persistent repository directory',
    '/help          show these controls',
    '/exit          leave CommandHUD',
  ].join('\n');
}

export function parseShellEvidenceCommand(command, fallbackRunId) {
  const match = String(command || '').match(/^\/(raw|head|tail|find|around)(?:\s+(.*))?$/);
  if (!match) return null;
  const mode = match[1];
  const parts = match[2]?.trim().split(/\s+/).filter(Boolean) || [];
  const isRunId = (value) => /^\d{14}-[0-9a-f]{4}$/i.test(value || '');
  let runId = isRunId(parts[0]) ? parts.shift() : fallbackRunId;
  if ((mode === 'head' || mode === 'tail') && /^\d+$/.test(parts[0] || '') && isRunId(parts[1])) {
    const count = parts.shift(); runId = parts.shift();
    if (parts.length) throw new Error(`Syntax: /${mode} <run> [count]`);
    return { runId, mode, count };
  }
  if (!runId) throw new Error('No command has been recorded yet.');
  if (mode === 'raw') {
    if (parts.length) throw new Error('Syntax: /raw <run>');
    return { runId, mode };
  }
  if (mode === 'head' || mode === 'tail') {
    if (parts.length > 1 || (parts[0] && !/^\d+$/.test(parts[0]))) throw new Error(`Syntax: /${mode} <run> [count]`);
    return { runId, mode, count: parts[0] };
  }
  if (mode === 'find') {
    if (!parts.length) throw new Error('Syntax: /find <run> <pattern>');
    return { runId, mode, pattern: parts.join(' ') };
  }
  const context = /^\d+$/.test(parts.at(-1) || '') ? parts.pop() : undefined;
  if (!parts.length) throw new Error('Syntax: /around <run> <pattern> [lines]');
  return { runId, mode, pattern: parts.join(' '), context };
}

export function renderShellEvidenceProjection(value) {
  const lines = [`SOURCE_EVIDENCE run:${value.runId} · ${value.mode.toUpperCase()}`];
  for (const stream of value.streams) {
    lines.push('', `${stream.stream.toUpperCase()}${stream.matchCount === undefined ? '' : ` · ${stream.matchCount} matches`}`);
    if (value.mode === 'raw') lines.push(stream.content || '(empty)');
    else lines.push(...(stream.lines.length ? stream.lines.map((line) => `${line.number}: ${line.text}`) : ['(no matching lines)']));
    if (stream.truncated) lines.push('… additional matching context retained in raw evidence');
  }
  return lines.join('\n').trimEnd();
}

function result(name, values = {}) { return { kind: 'builtin', name, ...values }; }

const builtins = [
  { name: 'exit', aliases: ['exit', 'quit'], match: /^\/(exit|quit)$/, execute: async () => result('exit', { exit: true }) },
  { name: 'help', aliases: ['help'], match: /^\/help$/, execute: async () => result('help', { text: shellHelp() }) },
  { name: 'cwd', aliases: ['cwd'], match: /^\/cwd$/, execute: async (session) => result('cwd', { text: session.cwd }) },
  { name: 'shell', aliases: ['shell'], match: /^\/shell(?:\s+(\S+))?$/, execute: async (session, match) => {
    const selected = session.setProvider(match[1]);
    return result('shell', { text: `SHELL ${selected.label}`, provider: selected });
  } },
  { name: 'copy', aliases: ['copy', 'context'], match: /^\/(copy|context)(?:\s+(\S+))?$/, execute: async (session, match) => {
    const selected = match[2] ? runById(session.project, match[2]) : lastRun(session.project);
    if (!selected?.operation) throw new Error(match[2] ? `No structured run found for ${match[2]}.` : 'No structured command has been recorded yet.');
    const text = (await buildCurrentOperationContext(session.project, selected)).handoff;
    return result(match[1], { text, clipboard: match[1] === 'copy' ? text : null, clipboardSource: `run:${selected.id}` });
  } },
  { name: 'evidence', aliases: ['raw', 'head', 'tail', 'find', 'around'], match: /^\/(raw|head|tail|find|around)(?:\s|$)/, execute: async (session, _match, command) => {
    const request = parseShellEvidenceCommand(command, lastRun(session.project)?.id);
    const value = projectRunEvidence(session.project, request.runId, request);
    const text = renderShellEvidenceProjection(value);
    return result(request.mode, { text, clipboard: text, clipboardSource: `run:${request.runId}` });
  } },
  { name: 'diff', aliases: ['diff'], match: /^\/diff(?:\s+(\S+)\s+(\S+))?$/, execute: async (session, match) => {
    if (!match[1] || !match[2]) throw new Error('/diff requires two recorded run IDs.');
    const value = await diffRunEvidence(session.project, match[1], match[2]);
    const lines = [`SOURCE_EVIDENCE runs:${match[1]},${match[2]} · DIFF`, `DIFFERENT ${value.different}`];
    for (const stream of value.streams) {
      lines.push('', `${stream.stream.toUpperCase()} ${stream.different ? 'CHANGED' : 'UNCHANGED'}`);
      if (stream.text) lines.push(stream.text);
      if (stream.truncated) lines.push('… complete evidence remains in both runs');
    }
    const text = lines.join('\n');
    return result('diff', { text, clipboard: text, clipboardSource: `runs:${match[1]},${match[2]}` });
  } },
  { name: 'history', aliases: ['history'], match: /^\/history(?:\s+(\S+))?$/, execute: async (session, match) => {
    const count = match[1] === undefined ? 10 : Number(match[1]);
    if (!Number.isInteger(count) || count < 1 || count > 100) throw new Error('/history requires a count from 1 to 100.');
    return result('history', { text: listRuns(session.project, count).map((run) => `${run.id} ${run.status.toUpperCase()} ${run.operation?.displayCommand || run.command}`).join('\n') || '(no recorded runs)' });
  } },
  { name: 'proof', aliases: ['proof'], match: /^\/proof(?:\s+(\S+))?$/, execute: async (session, match) => {
    if (!match[1]) throw new Error('/proof requires exactly one repository command name.');
    const proof = await repositoryCommandProof(session.project, match[1]);
    const text = formatRepositoryCommandProof(proof);
    return result('proof', { text, clipboard: text, clipboardSource: `proof:${match[1]}` });
  } },
  { name: 'undo', aliases: ['undo'], match: /^\/undo(?:\s+(\S+))?$/, execute: async (session, match) => {
    const target = match[1] ? listRuns(session.project, 100).find((run) => run.id === match[1]) : lastRun(session.project);
    if (!target) throw new Error('No recorded command is available for Undo.');
    const plan = await undoPlan(session.project, target.id);
    const lines = [`UNDO ${plan.state} · run:${target.id}`, plan.reason, ...plan.paths];
    if (!match[1] && plan.state === 'SAFE') lines.push(`Apply explicitly with /undo ${target.id}`);
    if (match[1] && plan.state === 'SAFE') return result('undo', { record: await undoOperation(session.project, target.id, { origin: 'terminal-ui' }) });
    return result('undo', { text: lines.join('\n') });
  } },
];

export function listShellBuiltins() {
  return builtins.map(({ name, aliases }) => ({ name, aliases: [...aliases] }));
}

export async function executeShellBuiltin(session, command) {
  const text = String(command).trim();
  if (!text.startsWith('/')) return null;
  for (const builtin of builtins) {
    const match = text.match(builtin.match);
    if (match) return builtin.execute(session, match, text);
  }
  return null;
}

export function matchesShellBuiltin(command) {
  const text = String(command).trim();
  return text.startsWith('/') && builtins.some((builtin) => builtin.match.test(text));
}
