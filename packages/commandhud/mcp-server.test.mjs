import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Script } from 'node:vm';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { resolveProject } from './core.mjs';

test('CommandHUD MCP exposes only its typed control panel and agent lifecycle tools', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'commandhud-mcp-project-'));
  const store = mkdtempSync(join(tmpdir(), 'commandhud-mcp-state-'));
  mkdirSync(join(root, 'distribution'));
  writeFileSync(join(root, 'distribution', 'project.json'), JSON.stringify({ id: 'indrolend/mcp-fixture', name: 'MCP Fixture' }));
  writeFileSync(join(root, 'file.txt'), 'fixture\n');
  execFileSync('git', ['init', '-b', 'main'], { cwd: root, stdio: 'pipe' });
  execFileSync('git', ['config', 'user.email', 'hud@example.invalid'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'HUD Test'], { cwd: root });
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['commit', '-m', 'fixture'], { cwd: root, stdio: 'pipe' });
  await resolveProject({ root, env: { ...process.env, HUD_STATE_ROOT: store } });

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [resolve(import.meta.dirname, '..', '..', 'plugins', 'commandhud-remote', 'server.mjs')],
    env: { ...process.env, HUD_STATE_ROOT: store, NODE_ENV: 'test' },
    stderr: 'pipe',
  });
  const client = new Client({ name: 'commandhud-mcp-test', version: '1.0.0' });
  t.after(() => client.close());
  await client.connect(transport);
  const listed = await client.listTools();
  assert.deepEqual(listed.tools.map((tool) => tool.name).sort(), [
    'discard_agent_workspace', 'get_agent', 'list_agent_sessions', 'list_agents',
    'list_projects', 'open_commandhud', 'start_agent', 'stop_agent',
  ]);
  const exposedInputNames = listed.tools.flatMap((tool) => Object.keys(tool.inputSchema?.properties || {}));
  assert.equal(exposedInputNames.some((name) => /shell|exec|command|pid|cwd|root|path/i.test(name)), false);
  const panelTool = listed.tools.find((tool) => tool.name === 'open_commandhud');
  assert.equal(panelTool.annotations.readOnlyHint, true);
  assert.equal(panelTool._meta.ui.resourceUri, 'ui://commandhud/control-panel-v2.html');
  assert.equal(panelTool._meta['openai/outputTemplate'], 'ui://commandhud/control-panel-v2.html');

  const resources = await client.listResources();
  assert.deepEqual(resources.resources.map(({ uri, mimeType }) => ({ uri, mimeType })), [{
    uri: 'ui://commandhud/control-panel-v2.html', mimeType: 'text/html;profile=mcp-app',
  }]);
  const panelResource = await client.readResource({ uri: 'ui://commandhud/control-panel-v2.html' });
  assert.equal(panelResource.contents[0].mimeType, 'text/html;profile=mcp-app');
  assert.match(panelResource.contents[0].text, /window\.openai\?\.callTool/);
  assert.match(panelResource.contents[0].text, /No paid fallback occurs automatically/);
  const widgetScript = panelResource.contents[0].text.match(/<script>([\s\S]*)<\/script>/)?.[1];
  assert.ok(widgetScript);
  assert.doesNotThrow(() => new Script(widgetScript));

  const panel = await client.callTool({ name: 'open_commandhud', arguments: {} });
  assert.equal(panel.structuredContent.projects.length, 1);
  assert.equal(panel.structuredContent.recipes.length, 7);
  assert.deepEqual(panel.structuredContent.routing, {
    policy: 'local-first-explicit-paid-escalation',
    allowPaid: false,
    candidates: [{
      agent: 'codex/ollama',
      reason: 'Prefer local execution to retain project data and avoid paid model usage.',
    }],
    automaticPaidFallback: false,
  });
  assert.equal(JSON.stringify(panel.structuredContent).includes(root), false);
  const projects = await client.callTool({ name: 'list_projects', arguments: {} });
  assert.deepEqual(projects.structuredContent.projects, [{
    id: 'indrolend/mcp-fixture', name: 'MCP Fixture', branch: 'main',
    head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    dirty: false, changedFileCount: 0,
  }]);
  assert.equal(JSON.stringify(projects.structuredContent).includes(root), false);
  const agents = await client.callTool({ name: 'list_agents', arguments: { project: 'indrolend/mcp-fixture' } });
  assert.deepEqual(Object.fromEntries(agents.structuredContent.agents.map((agent) => [agent.id, agent.dataBoundary])), {
    'codex/local': 'external-provider',
    'codex/ollama': 'local-machine',
  });
  const sessions = await client.callTool({ name: 'list_agent_sessions', arguments: { project: 'indrolend/mcp-fixture', limit: 25 } });
  assert.deepEqual(sessions.structuredContent.sessions, []);
  const startTool = listed.tools.find((tool) => tool.name === 'start_agent');
  assert.equal(startTool.inputSchema.properties.agent.type, 'string');
  assert.equal(startTool.inputSchema.properties.agent.default, 'codex/ollama');
  assert.equal('const' in startTool.inputSchema.properties.agent, false);
  assert.equal('enum' in startTool.inputSchema.properties.agent, false);
  assert.equal(startTool.inputSchema.properties.allow_paid.default, false);
  const paidWithoutAuthorization = await client.callTool({ name: 'start_agent', arguments: {
    project: 'indrolend/mcp-fixture', objective: 'must not launch',
    expected_head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    agent: 'codex/local',
  } });
  assert.equal(paidWithoutAuthorization.isError, true);
  assert.match(paidWithoutAuthorization.content[0].text, /requires explicit allow_paid=true authorization/);
  const stale = await client.callTool({ name: 'start_agent', arguments: {
    project: 'indrolend/mcp-fixture', objective: 'must not launch', expected_head: '0'.repeat(40),
    agent: 'codex/local', allow_paid: true,
  } });
  assert.equal(stale.isError, true);
  assert.match(stale.content[0].text, /does not match current HEAD/);
});
