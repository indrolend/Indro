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

async function callHomeMedia(env: HomeEnv, path: string) {
  const response = await fetch(env.HOME_EXECUTOR_URL + path, { headers: { Authorization: "Bearer " + env.HOME_EXECUTOR_TOKEN } });
  const error = !response.ok ? await response.text() : null;
  if (!response.ok) throw new Error(`Home executor returned HTTP ${response.status}: ${error?.slice(0, 500)}`);
  const mediaType = response.headers.get("content-type") || "application/octet-stream";
  const byteLength = Number(response.headers.get("content-length") || 0);
  const disposition = response.headers.get("content-disposition") || "";
  const encodedName = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1] || "artifact";
  const bytes = await response.arrayBuffer();
  const receivedSha256 = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)))
    .map((byte) => byte.toString(16).padStart(2, "0")).join("");
  const expectedSha256 = response.headers.get("x-commandhud-artifact-sha256");
  if (byteLength !== bytes.byteLength) throw new Error(`Home media length mismatch: expected ${byteLength}, received ${bytes.byteLength}.`);
  if (!expectedSha256 || receivedSha256 !== expectedSha256) throw new Error("Home media SHA-256 verification failed.");
  const descriptor = {
    id: response.headers.get("x-commandhud-artifact-id"),
    name: decodeURIComponent(encodedName), mediaType, byteLength,
    sha256: receivedSha256,
    jobId: response.headers.get("x-commandhud-job-id"),
    head: response.headers.get("x-commandhud-source-head"),
    project: decodeURIComponent(response.headers.get("x-commandhud-project") || ""),
    path: decodeURIComponent(response.headers.get("x-commandhud-path") || ""),
  };
  return { descriptor, data: Buffer.from(bytes).toString("base64") };
}

function result(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }], structuredContent: value as Record<string, unknown> };
}

const project = z.string().min(1).max(300).describe("Exact project ID returned by commandhud.projects");
const job = z.string().regex(/^\d{14}-[0-9a-f]{4}$/i).describe("Exact durable CommandHUD job ID");
const relativePath = z.string().min(1).max(4096).describe("Path relative to the isolated sandbox workspace; absolute and parent paths are rejected");

export function registerHomeTools(server: McpServer, env: HomeEnv) {
  server.registerTool("commandhud.home.status", { description: "Report whether the authenticated home Windows executor is reachable." }, async () => result(await callHome(env, "/health")));
  server.registerTool("commandhud.projects", { description: "List verified projects known to the home CommandHUD authority." }, async () => result(await callHome(env, "/projects")));
  server.registerTool("commandhud.project.state", {
    description: "Measure current Git authority and active work for one verified project.", inputSchema: { project },
  }, async ({ project: projectId }) => result(await callHome(env, `/project-state?project=${encodeURIComponent(projectId)}`)));
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
  server.registerTool("commandhud.sandbox.create", {
    description: "Create a persistent isolated Git worktree for an iterative ChatGPT development job without starting a model.",
    inputSchema: { project, task: z.string().min(1).max(128 * 1024), expectedHead: z.string().regex(/^[0-9a-f]{40}$/i) },
  }, async (input) => result(await callHome(env, "/sandboxes", { method: "POST", body: JSON.stringify(input) })));
  server.registerTool("commandhud.sandbox.list", {
    description: "List retained iterative sandbox jobs for one verified project.", inputSchema: { project, limit: z.number().int().min(1).max(100).default(25) },
  }, async ({ project: projectId, limit }) => result(await callHome(env, `/sandboxes?project=${encodeURIComponent(projectId)}&limit=${limit}`)));
  server.registerTool("commandhud.sandbox.status", {
    description: "Measure current Git state for one retained sandbox job.", inputSchema: { project, job },
  }, async ({ project: projectId, job: jobId }) => result(await callHome(env, `/sandboxes/${jobId}?project=${encodeURIComponent(projectId)}`)));
  server.registerTool("commandhud.sandbox.exec", {
    description: "Execute one bounded argv command inside a sandbox workspace and retain stdout, stderr, exit status, Git state, and operation delta.",
    inputSchema: {
      project, job,
      argv: z.array(z.string().min(1).max(32768)).min(1).max(64),
      cwd: relativePath.default("."), timeoutMs: z.number().int().min(1000).max(600000).default(120000),
    },
  }, async ({ project: projectId, job: jobId, argv, cwd, timeoutMs }) => result(await callHome(env, `/sandboxes/${jobId}/exec`, { method: "POST", body: JSON.stringify({ project: projectId, argv, cwd, timeoutMs }) })));
  server.registerTool("commandhud.sandbox.read", {
    description: "Read at most 400 lines from one contained text file in a sandbox.",
    inputSchema: { project, job, path: relativePath, startLine: z.number().int().min(1).default(1), endLine: z.number().int().min(1).default(200) },
  }, async ({ project: projectId, job: jobId, path, startLine, endLine }) => result(await callHome(env, `/sandboxes/${jobId}/read?project=${encodeURIComponent(projectId)}&path=${encodeURIComponent(path)}&startLine=${startLine}&endLine=${endLine}`)));
  server.registerTool("commandhud.sandbox.media", {
    description: "Return one hash-verified image from a contained sandbox as a renderable MCP image plus its transport-independent descriptor.",
    inputSchema: { project, job, path: relativePath },
  }, async ({ project: projectId, job: jobId, path }) => {
    const artifact = await callHomeMedia(env, `/sandboxes/${jobId}/media?project=${encodeURIComponent(projectId)}&path=${encodeURIComponent(path)}`);
    return {
      content: [
        { type: "image" as const, data: artifact.data, mimeType: artifact.descriptor.mediaType },
        { type: "text" as const, text: JSON.stringify(artifact.descriptor, null, 2) },
      ],
      structuredContent: artifact.descriptor,
    };
  });
  server.registerTool("commandhud.sandbox.search", {
    description: "Search a sandbox with retained ripgrep evidence and compact file/line matches.",
    inputSchema: { project, job, query: z.string().min(1).max(8192), scope: relativePath.default(".") },
  }, async ({ project: projectId, job: jobId, query, scope }) => result(await callHome(env, `/sandboxes/${jobId}/search`, { method: "POST", body: JSON.stringify({ project: projectId, query, scope }) })));
  server.registerTool("commandhud.sandbox.patch", {
    description: "Validate and apply a bounded unified diff only inside an isolated sandbox workspace.",
    inputSchema: { project, job, patch: z.string().min(1).max(256 * 1024) },
  }, async ({ project: projectId, job: jobId, patch }) => result(await callHome(env, `/sandboxes/${jobId}/patch`, { method: "POST", body: JSON.stringify({ project: projectId, patch }) })));
  server.registerTool("commandhud.sandbox.diff", {
    description: "Return the current Git diff and immutable evidence identity for a sandbox.", inputSchema: { project, job },
  }, async ({ project: projectId, job: jobId }) => result(await callHome(env, `/sandboxes/${jobId}/diff`, { method: "POST", body: JSON.stringify({ project: projectId }) })));
  server.registerTool("commandhud.sandbox.discard", {
    description: "Explicitly remove a CommandHUD-owned sandbox worktree while retaining its historical job and operation evidence.", inputSchema: { project, job },
  }, async ({ project: projectId, job: jobId }) => result(await callHome(env, `/sandboxes/${jobId}/actions`, { method: "POST", body: JSON.stringify({ project: projectId, action: "discard" }) })));
  server.registerTool("brokeman.result", {
    description: "Return compact Brokeman continuity and verified packet metadata for one CommandHUD job.", inputSchema: { job },
  }, async ({ job: jobId }) => result(await callHome(env, `/brokeman/result?job=${encodeURIComponent(jobId)}`)));
  server.registerTool("brokeman.packet", {
    description: "Generate the allowlisted Brokeman packet locally and return only its verified descriptor, never its body.", inputSchema: { job },
  }, async ({ job: jobId }) => result(await callHome(env, "/brokeman/packet", { method: "POST", body: JSON.stringify({ job: jobId }) })));
}
