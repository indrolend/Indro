#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import * as z from 'zod/v4';
import { existsSync, readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  agentSession, applySandboxPatch, createSandboxJob, discardAgentWorkspace, discardSandboxJob,
  discoverAgentHarnesses, discoverProjects, executeSandboxCommand, gitSnapshot, listAgentSessions,
  listSandboxJobs, planAgentRoute, readSandboxFile, resolveRegisteredProject, sandboxDiff,
  sandboxJobState, searchSandbox, startDetachedAgent, stopAgentSession,
} from '../../packages/commandhud/core.mjs';
import { commandHudRecipes } from './recipes.mjs';

const server = new McpServer({ name: 'commandhud-remote', version: '0.1.3' });
const widgetUri = 'ui://commandhud/control-panel-v2.html';
const widgetHtml = readFileSync(fileURLToPath(new URL('./widget/commandhud-widget.html', import.meta.url)), 'utf8');
const projectId = z.string().min(1).max(300).describe('Exact project ID returned by list_projects');
const sessionId = z.string().regex(/^\d{14}-[0-9a-f]{4}$/i).describe('Exact CommandHUD session ID');
const agentId = z.string().min(1).max(100).default('codex/ollama')
  .describe('Exact available agent ID returned by list_agents; defaults to the local-free codex/ollama harness');
const allowPaid = z.boolean().default(false)
  .describe('Must be true to authorize an external-provider, account-metered harness; never enables automatic fallback');
const result = (value) => ({
  content: [{ type: 'text', text: JSON.stringify(value) }],
  structuredContent: value,
});
const relativePath = z.string().min(1).max(4096).describe('Path relative to the isolated sandbox workspace');
const remoteSession = (value) => value && ({
  id: value.id, status: value.status, reason: value.reason, agent: value.agent,
  provider: value.provider, runtime: value.runtime, costClass: value.costClass,
  dataBoundary: value.dataBoundary, externalTransmission: value.externalTransmission,
  project: value.project, baseSha: value.baseSha, head: value.head, dirty: value.dirty,
  objective: value.objective, startedAt: value.startedAt, updatedAt: value.updatedAt,
  changedFiles: value.changedFiles, message: value.message, evidence: value.evidence,
});
const remoteSandbox = (value) => value && ({
  id: value.id, project: value.project, task: value.task, status: value.status,
  baseSha: value.baseSha, head: value.head ?? null, branch: value.branch ?? null,
  dirty: value.dirty ?? null, changedFiles: value.changedFiles || [],
  sourceAuthorityCurrent: value.sourceAuthorityCurrent ?? null,
  workspaceAvailable: value.workspaceAvailable, activeOperation: value.activeOperation ?? false,
  createdAt: value.createdAt, updatedAt: value.updatedAt,
  lastOperationId: value.lastOperationId, lastOperationKind: value.lastOperationKind,
  discardedAt: value.discardedAt || null,
});
const boundedEvidence = (path, limit) => {
  if (!path || !existsSync(path)) return { text: '', truncated: false };
  const value = readFileSync(path, 'utf8');
  return value.length <= limit ? { text: value, truncated: false } : { text: value.slice(-limit), truncated: true };
};
const remoteOperation = (value) => {
  const stdout = boundedEvidence(value?.stdoutPath, 64 * 1024);
  const stderr = boundedEvidence(value?.stderrPath, 32 * 1024);
  return value && {
    id: value.id, status: value.status, resultReason: value.resultReason,
    exitCode: value.exitCode, durationMs: value.durationMs,
    headBefore: value.headBefore, headAfter: value.headAfter,
    dirtyBefore: value.dirtyBefore, dirtyAfter: value.dirtyAfter,
    changedFiles: value.changedFiles || [], stdout: stdout.text, stderr: stderr.text,
    stdoutTruncated: stdout.truncated || value.capture?.stdoutTruncated || false,
    stderrTruncated: stderr.truncated || value.capture?.stderrTruncated || false,
    evidence: value.evidence,
  };
};

const brokemanAuthority = async () => {
  const project = (await discoverProjects()).find((candidate) => candidate.id === 'indrolend/brokeman');
  const script = project?.root && join(project.root, 'brokeman.ps1');
  if (!project?.root || !existsSync(script)) throw new Error('The registered Brokeman entrypoint is unavailable.');
  return { root: project.root, script };
};

const invokeBrokeman = async (command, job) => {
  const authority = await brokemanAuthority();
  return new Promise((resolve, reject) => {
    const child = spawn('pwsh.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', authority.script, command, job, '-Json'], {
      cwd: authority.root, windowsHide: true, shell: false, env: process.env,
    });
    let stdout = '', stderr = '';
    child.stdout.on('data', (chunk) => { if (stdout.length < 512 * 1024) stdout += chunk; });
    child.stderr.on('data', (chunk) => { if (stderr.length < 64 * 1024) stderr += chunk; });
    child.once('error', reject);
    child.once('close', (code) => {
      if (code !== 0) return reject(new Error(`Brokeman ${command} failed: ${(stderr || stdout).slice(-2000)}`));
      try { resolve(JSON.parse(stdout)); } catch { reject(new Error(`Brokeman ${command} returned malformed JSON.`)); }
    });
  });
};

const publishBrokemanPacket = async (job) => {
  const authority = await brokemanAuthority();
  await new Promise((resolve, reject) => {
    const child = spawn('pwsh.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', authority.script, 'packet', job], {
      cwd: authority.root, windowsHide: true, shell: false, stdio: 'ignore', env: process.env,
    });
    child.once('error', reject);
    child.once('close', (code) => code === 0 ? resolve() : reject(new Error('Brokeman packet publication failed.')));
  });
  return invokeBrokeman('result', job);
};

const startBrokemanWatcher = async (job) => {
  try {
    const authority = await brokemanAuthority();
    const child = spawn('pwsh.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', authority.script, 'watch', job, '-NotifyStarted'], {
      cwd: authority.root, detached: true, windowsHide: true, stdio: 'ignore', env: process.env,
    });
    child.unref();
    return true;
  } catch { return false; }
};

server.registerResource('CommandHUD control panel', widgetUri, {
  description: 'Interactive local-first CommandHUD project and agent-session controls.',
  mimeType: 'text/html;profile=mcp-app',
  _meta: {
    ui: { csp: { connectDomains: [], resourceDomains: [] }, prefersBorder: true },
    'openai/widgetDescription': 'Choose a verified project, common task recipe, local or explicitly paid harness, and manage retained agent sessions.',
  },
}, async () => ({ contents: [{ uri: widgetUri, mimeType: 'text/html;profile=mcp-app', text: widgetHtml }] }));

server.registerTool('open_commandhud', {
  description: 'Open the interactive CommandHUD control panel for verified projects and evidence-backed agent sessions.',
  inputSchema: {},
  annotations: { title: 'Open CommandHUD', readOnlyHint: true, openWorldHint: false },
  _meta: { ui: { resourceUri: widgetUri }, 'openai/outputTemplate': widgetUri },
}, async () => {
  const projects = (await discoverProjects()).map(({ root, ...project }) => project);
  const agents = await discoverAgentHarnesses();
  return {
    content: [{ type: 'text', text: `CommandHUD is ready with ${projects.length} verified project${projects.length === 1 ? '' : 's'}.` }],
    structuredContent: { projects, agents, recipes: commandHudRecipes(), routing: planAgentRoute() },
    _meta: { ui: { resourceUri: widgetUri } },
  };
});

server.registerTool('list_projects', {
  description: 'List locally registered Git projects after re-verifying their identity and current Git state.',
  inputSchema: {},
  annotations: { title: 'List CommandHUD projects', readOnlyHint: true, openWorldHint: false },
}, async () => result({ projects: (await discoverProjects()).map(({ root, ...project }) => project) }));

server.registerTool('project_state', {
  description: 'Measure current Git authority and active jobs for one verified project.',
  inputSchema: { project: projectId }, annotations: { title: 'Inspect project state', readOnlyHint: true, openWorldHint: false },
}, async ({ project }) => {
  const selected = await resolveRegisteredProject(project);
  return result({ project, git: await gitSnapshot(selected.root), sandboxes: (await listSandboxJobs(selected)).map(remoteSandbox), agents: listAgentSessions(selected).map(remoteSession) });
});

server.registerTool('list_agents', {
  description: 'List trusted local agent harnesses available for a verified registered project.',
  inputSchema: { project: projectId },
  annotations: { title: 'List local agent harnesses', readOnlyHint: true, openWorldHint: false },
}, async ({ project }) => {
  await resolveRegisteredProject(project);
  return result({ agents: await discoverAgentHarnesses() });
});

server.registerTool('start_agent', {
  description: 'Start a detached agent in an isolated worktree at an exact expected Git HEAD.',
  inputSchema: {
    project: projectId,
    objective: z.string().min(1).max(128 * 1024),
    expected_head: z.string().regex(/^[0-9a-f]{40}$/i),
    agent: agentId,
    allow_paid: allowPaid,
  },
  annotations: { title: 'Start isolated local agent', readOnlyHint: false, destructiveHint: true, openWorldHint: false },
}, async ({ project, objective, expected_head, agent, allow_paid }) => {
  const selected = await resolveRegisteredProject(project);
  const harnesses = await discoverAgentHarnesses();
  const harness = harnesses.find((candidate) => candidate.id === agent);
  if (!harness) throw new Error(`Unknown agent harness: ${agent}. Use list_agents for trusted harness IDs.`);
  if (!harness.available) throw new Error(`Agent harness is not available: ${agent}. Use list_agents for current availability.`);
  if (harness.dataBoundary === 'external-provider' && allow_paid !== true) {
    throw new Error(`Paid external-provider harness requires explicit allow_paid=true authorization: ${agent}`);
  }
  const session = await startDetachedAgent(selected, objective, { agent, expectedHead: expected_head });
  return result({ ...remoteSession(session), continuityProjection: await startBrokemanWatcher(session.id) });
});

server.registerTool('list_agent_sessions', {
  description: 'List derived local agent session state for a verified registered project.',
  inputSchema: { project: projectId, limit: z.number().int().min(1).max(100).default(25) },
  annotations: { title: 'List agent sessions', readOnlyHint: true, openWorldHint: false },
}, async ({ project, limit }) => {
  const selected = await resolveRegisteredProject(project);
  return result({ sessions: listAgentSessions(selected, limit).map(remoteSession) });
});

server.registerTool('get_agent', {
  description: 'Get one agent session from its journal or immutable final evidence.',
  inputSchema: { project: projectId, session_id: sessionId },
  annotations: { title: 'Inspect agent session', readOnlyHint: true, openWorldHint: false },
}, async ({ project, session_id }) => {
  const selected = await resolveRegisteredProject(project);
  const session = agentSession(selected, session_id);
  if (!session) throw new Error(`Agent session was not found: ${session_id}`);
  return result(remoteSession(session));
});

server.registerTool('stop_agent', {
  description: 'Request bounded cancellation of one running agent identified by retained CommandHUD evidence.',
  inputSchema: { project: projectId, session_id: sessionId },
  annotations: { title: 'Stop agent session', readOnlyHint: false, destructiveHint: true, openWorldHint: false },
}, async ({ project, session_id }) => {
  const selected = await resolveRegisteredProject(project);
  return result(stopAgentSession(selected, session_id));
});

server.registerTool('discard_agent_workspace', {
  description: 'Discard the registered isolated worktree of a terminal agent session while retaining its evidence.',
  inputSchema: { project: projectId, session_id: sessionId },
  annotations: { title: 'Discard agent workspace', readOnlyHint: false, destructiveHint: true, openWorldHint: false },
}, async ({ project, session_id }) => {
  const selected = await resolveRegisteredProject(project);
  return result(await discardAgentWorkspace(selected, session_id));
});

server.registerTool('create_sandbox', {
  description: 'Create a persistent isolated Git worktree for an iterative development job without starting a model.',
  inputSchema: { project: projectId, task: z.string().min(1).max(128 * 1024), expected_head: z.string().regex(/^[0-9a-f]{40}$/i) },
  annotations: { title: 'Create development sandbox', readOnlyHint: false, destructiveHint: false, openWorldHint: false },
}, async ({ project, task, expected_head }) => {
  const selected = await resolveRegisteredProject(project);
  return result(remoteSandbox(await createSandboxJob(selected, task, { expectedHead: expected_head })));
});

server.registerTool('list_sandboxes', {
  description: 'List retained iterative sandbox jobs for one verified project.',
  inputSchema: { project: projectId, limit: z.number().int().min(1).max(100).default(25) },
  annotations: { title: 'List development sandboxes', readOnlyHint: true, openWorldHint: false },
}, async ({ project, limit }) => {
  const selected = await resolveRegisteredProject(project);
  return result({ sandboxes: (await listSandboxJobs(selected, limit)).map(remoteSandbox) });
});

server.registerTool('sandbox_status', {
  description: 'Measure current Git state for one retained sandbox job.',
  inputSchema: { project: projectId, job: sessionId }, annotations: { title: 'Inspect sandbox', readOnlyHint: true, openWorldHint: false },
}, async ({ project, job }) => {
  const selected = await resolveRegisteredProject(project);
  return result(remoteSandbox(await sandboxJobState(selected, job)));
});

server.registerTool('sandbox_exec', {
  description: 'Execute one bounded argv command inside a sandbox and retain its complete evidence.',
  inputSchema: { project: projectId, job: sessionId, argv: z.array(z.string().min(1).max(32768)).min(1).max(64), cwd: relativePath.default('.'), timeout_ms: z.number().int().min(1000).max(600000).default(120000) },
  annotations: { title: 'Run sandbox command', readOnlyHint: false, destructiveHint: true, openWorldHint: false },
}, async ({ project, job, argv, cwd, timeout_ms }) => {
  const selected = await resolveRegisteredProject(project);
  return result(remoteOperation(await executeSandboxCommand(selected, job, argv, { cwd, timeoutMs: timeout_ms })));
});

server.registerTool('sandbox_read', {
  description: 'Read at most 400 lines from one contained sandbox text file.',
  inputSchema: { project: projectId, job: sessionId, path: relativePath, start_line: z.number().int().min(1).default(1), end_line: z.number().int().min(1).default(200) },
  annotations: { title: 'Read sandbox source', readOnlyHint: true, openWorldHint: false },
}, async ({ project, job, path, start_line, end_line }) => {
  const selected = await resolveRegisteredProject(project);
  return result(readSandboxFile(selected, job, path, { startLine: start_line, endLine: end_line }));
});

server.registerTool('sandbox_search', {
  description: 'Search a sandbox with retained ripgrep evidence and compact file/line matches.',
  inputSchema: { project: projectId, job: sessionId, query: z.string().min(1).max(8192), scope: relativePath.default('.') },
  annotations: { title: 'Search sandbox', readOnlyHint: true, openWorldHint: false },
}, async ({ project, job, query, scope }) => {
  const selected = await resolveRegisteredProject(project);
  const value = await searchSandbox(selected, job, query, { scope });
  return result({ operation: remoteOperation(value), matches: value.operation?.files || [] });
});

server.registerTool('sandbox_patch', {
  description: 'Validate and apply a bounded unified diff only inside an isolated sandbox.',
  inputSchema: { project: projectId, job: sessionId, patch: z.string().min(1).max(256 * 1024) },
  annotations: { title: 'Patch sandbox source', readOnlyHint: false, destructiveHint: true, openWorldHint: false },
}, async ({ project, job, patch }) => {
  const selected = await resolveRegisteredProject(project);
  return result(remoteOperation(await applySandboxPatch(selected, job, patch)));
});

server.registerTool('sandbox_diff', {
  description: 'Return the current Git diff and immutable evidence identity for a sandbox.',
  inputSchema: { project: projectId, job: sessionId }, annotations: { title: 'Inspect sandbox diff', readOnlyHint: true, openWorldHint: false },
}, async ({ project, job }) => {
  const selected = await resolveRegisteredProject(project);
  return result(remoteOperation(await sandboxDiff(selected, job)));
});

server.registerTool('discard_sandbox', {
  description: 'Explicitly remove a CommandHUD-owned sandbox worktree while retaining job and operation evidence.',
  inputSchema: { project: projectId, job: sessionId }, annotations: { title: 'Discard sandbox', readOnlyHint: false, destructiveHint: true, openWorldHint: false },
}, async ({ project, job }) => {
  const selected = await resolveRegisteredProject(project);
  return result(remoteSandbox(await discardSandboxJob(selected, job)));
});

server.registerTool('brokeman_result', {
  description: 'Return compact Brokeman continuity and verified packet metadata for one CommandHUD job.',
  inputSchema: { job: sessionId },
  annotations: { title: 'Get Brokeman result', readOnlyHint: true, openWorldHint: false },
}, async ({ job }) => result(await invokeBrokeman('result', job)));

server.registerTool('brokeman_packet', {
  description: 'Publish the allowlisted Brokeman packet locally and return only its verified descriptor.',
  inputSchema: { job: sessionId },
  annotations: { title: 'Publish Brokeman packet', readOnlyHint: false, destructiveHint: false, openWorldHint: false },
}, async ({ job }) => result(await publishBrokemanPacket(job)));

const transport = new StdioServerTransport();
await server.connect(transport);

