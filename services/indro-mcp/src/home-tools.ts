import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

type HomeEnv = { HOME_EXECUTOR_TOKEN: string; HOME_EXECUTOR_URL: string };

async function callHome(env: HomeEnv, path: string, init?: RequestInit) {
  const response = await fetch(env.HOME_EXECUTOR_URL + path, {
    ...init,
    headers: { ...(init?.headers || {}), Authorization: "Bearer " + env.HOME_EXECUTOR_TOKEN, "Content-Type": "application/json" },
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Home executor returned HTTP ${response.status}: ${text.slice(0, 500)}`);
  return text ? JSON.parse(text) : null;
}

function result(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }], structuredContent: value as Record<string, unknown> };
}

const project = z.string().min(1).max(300).describe("Exact project ID returned by commandhud.projects");
const job = z.string().regex(/^\d{14}-[0-9a-f]{4}$/i).describe("Exact durable CommandHUD job ID");

export function registerHomeTools(server: McpServer, env: HomeEnv) {
  server.registerTool("commandhud.home.status", { description: "Report whether the authenticated home Windows executor is reachable." }, async () => result(await callHome(env, "/health")));
  server.registerTool("commandhud.projects", { description: "List verified projects known to the home CommandHUD authority." }, async () => result(await callHome(env, "/projects")));
  server.registerTool("commandhud.agents", {
    description: "List trusted agent harnesses available for one verified project.", inputSchema: { project },
  }, async ({ project: projectId }) => result(await callHome(env, `/agents?project=${encodeURIComponent(projectId)}`)));
  server.registerTool("commandhud.agent.start", {
    description: "Start a detached agent in an isolated CommandHUD worktree at an exact expected Git HEAD.",
    inputSchema: {
      project,
      objective: z.string().min(1).max(128 * 1024),
      expectedHead: z.string().regex(/^[0-9a-f]{40}$/i),
      agent: z.enum(["codex/ollama", "codex/local"]).default("codex/ollama"),
      allowPaid: z.boolean().default(false),
    },
  }, async (input) => result(await callHome(env, "/agents/start", { method: "POST", body: JSON.stringify(input) })));
  server.registerTool("commandhud.agent.sessions", {
    description: "List bounded retained agent-session state for one verified project.", inputSchema: { project, limit: z.number().int().min(1).max(100).default(25) },
  }, async ({ project: projectId, limit }) => result(await callHome(env, `/agent-sessions?project=${encodeURIComponent(projectId)}&limit=${limit}`)));
  server.registerTool("commandhud.agent.get", {
    description: "Get one durable CommandHUD agent job without exposing local filesystem paths.", inputSchema: { project, job },
  }, async ({ project: projectId, job: jobId }) => result(await callHome(env, `/agents/${jobId}?project=${encodeURIComponent(projectId)}`)));
  server.registerTool("commandhud.agent.stop", {
    description: "Request bounded cancellation of one running CommandHUD agent job.", inputSchema: { project, job },
  }, async ({ project: projectId, job: jobId }) => result(await callHome(env, `/agents/${jobId}/actions`, { method: "POST", body: JSON.stringify({ project: projectId, action: "stop" }) })));
  server.registerTool("brokeman.result", {
    description: "Return compact Brokeman continuity and verified packet metadata for one CommandHUD job.", inputSchema: { job },
  }, async ({ job: jobId }) => result(await callHome(env, `/brokeman/result?job=${encodeURIComponent(jobId)}`)));
  server.registerTool("brokeman.packet", {
    description: "Generate the allowlisted Brokeman packet locally and return only its verified descriptor, never its body.", inputSchema: { job },
  }, async ({ job: jobId }) => result(await callHome(env, "/brokeman/packet", { method: "POST", body: JSON.stringify({ job: jobId }) })));
}
