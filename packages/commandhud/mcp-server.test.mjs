import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { resolveProject } from './core.mjs';

test('CommandHUD MCP exposes only typed project and agent lifecycle tools', async (t) => {
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
    'list_projects', 'start_agent', 'stop_agent',
  ]);
  assert.equal(listed.tools.some((tool) => /shell|exec|powershell/i.test(tool.name)), false);
  const projects = await client.callTool({ name: 'list_projects', arguments: {} });
  assert.deepEqual(projects.structuredContent.projects, [{
    id: 'indrolend/mcp-fixture', name: 'MCP Fixture', branch: 'main',
    head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    dirty: false, changedFileCount: 0,
  }]);
  assert.equal(JSON.stringify(projects.structuredContent).includes(root), false);
  const stale = await client.callTool({ name: 'start_agent', arguments: {
    project: 'indrolend/mcp-fixture', objective: 'must not launch', expected_head: '0'.repeat(40), agent: 'codex/local',
  } });
  assert.equal(stale.isError, true);
  assert.match(stale.content[0].text, /does not match current HEAD/);
});
