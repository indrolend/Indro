#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import * as z from 'zod/v4';
import {
  agentSession, discardAgentWorkspace, discoverAgentHarnesses, discoverProjects,
  listAgentSessions, resolveRegisteredProject, startDetachedAgent, stopAgentSession,
} from '../../packages/commandhud/core.mjs';

const server = new McpServer({ name: 'commandhud-remote', version: '0.1.0' });
const projectId = z.string().min(1).max(300).describe('Exact project ID returned by list_projects');
const sessionId = z.string().regex(/^\d{14}-[0-9a-f]{4}$/i).describe('Exact CommandHUD session ID');
const result = (value) => ({
  content: [{ type: 'text', text: JSON.stringify(value) }],
  structuredContent: value,
});
const remoteSession = (value) => value && ({
  id: value.id, status: value.status, reason: value.reason, agent: value.agent,
  project: value.project, baseSha: value.baseSha, head: value.head, dirty: value.dirty,
  objective: value.objective, startedAt: value.startedAt, updatedAt: value.updatedAt,
  changedFiles: value.changedFiles, message: value.message, evidence: value.evidence,
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
    agent: z.literal('codex/local').default('codex/local'),
  },
  annotations: { title: 'Start isolated local agent', readOnlyHint: false, destructiveHint: true, openWorldHint: false },
}, async ({ project, objective, expected_head, agent }) => {
  const selected = await resolveRegisteredProject(project);
  return result(remoteSession(await startDetachedAgent(selected, objective, { agent, expectedHead: expected_head })));
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

const transport = new StdioServerTransport();
await server.connect(transport);
