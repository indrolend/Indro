#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import * as z from 'zod/v4';
import { existsSync, readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  agentSession, discardAgentWorkspace, discoverAgentHarnesses, discoverProjects,
  listAgentSessions, planAgentRoute, resolveRegisteredProject, startDetachedAgent, stopAgentSession,
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
const remoteSession = (value) => value && ({
  id: value.id, status: value.status, reason: value.reason, agent: value.agent,
  provider: value.provider, runtime: value.runtime, costClass: value.costClass,
  dataBoundary: value.dataBoundary, externalTransmission: value.externalTransmission,
  project: value.project, baseSha: value.baseSha, head: value.head, dirty: value.dirty,
  objective: value.objective, startedAt: value.startedAt, updatedAt: value.updatedAt,
  changedFiles: value.changedFiles, message: value.message, evidence: value.evidence,
});

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

