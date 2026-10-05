import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

type HomeEnv = {
  HOME_EXECUTOR_TOKEN: string;
  HOME_EXECUTOR_URL: string;
};

async function callHome(env: HomeEnv, path: string, init?: RequestInit) {
  const response = await fetch(env.HOME_EXECUTOR_URL + path, {
    ...init,
    headers: {
      ...(init?.headers || {}),
      Authorization: "Bearer " + env.HOME_EXECUTOR_TOKEN,
      "Content-Type": "application/json",
    },
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Home executor returned HTTP ${response.status}: ${text.slice(0, 500)}`);
  return text ? JSON.parse(text) : null;
}

function result(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}

export function registerHomeTools(server: McpServer, env: HomeEnv) {
  server.registerTool(
    "commandhud.home.status",
    { description: "Report whether the authenticated home Windows executor is reachable." },
    async () => result(await callHome(env, "/health")),
  );

  server.registerTool(
    "commandhud.projects",
    { description: "List sanitized projects discovered by the home CommandHUD authority." },
    async () => result(await callHome(env, "/projects")),
  );

  server.registerTool(
    "commandhud.repo.status",
    {
      description: "Return branch, HEAD, upstream, dirty-state summary, and compact status for a discovered project.",
      inputSchema: {
        project: z.string().describe("Project name from commandhud.projects."),
      },
    },
    async ({ project }) =>
      result(await callHome(env, `/repo/status?project=${encodeURIComponent(project)}`)),
  );

  server.registerTool(
    "commandhud.repo.log",
    {
      description: "Return a bounded recent Git log for a discovered project.",
      inputSchema: {
        project: z.string(),
        count: z.number().int().min(1).max(50).default(15),
      },
    },
    async ({ project, count }) =>
      result(await callHome(env, `/repo/log?project=${encodeURIComponent(project)}&count=${count}`)),
  );

  server.registerTool(
    "commandhud.repo.diff",
    {
      description: "Return a bounded working-tree diff for a discovered project.",
      inputSchema: {
        project: z.string(),
      },
    },
    async ({ project }) =>
      result(await callHome(env, `/repo/diff?project=${encodeURIComponent(project)}`)),
  );

  server.registerTool(
    "commandhud.source.search",
    {
      description: "Search tracked/project source with ripgrep and return bounded matching lines.",
      inputSchema: {
        project: z.string(),
        query: z.string(),
        maxResults: z.number().int().min(1).max(200).default(50),
      },
    },
    async ({ project, query, maxResults }) =>
      result(await callHome(
        env,
        `/source/search?project=${encodeURIComponent(project)}&q=${encodeURIComponent(query)}&max=${maxResults}`,
      )),
  );

  server.registerTool(
    "commandhud.verify",
    {
      description: "Run a named repository-declared verification command. Arbitrary shell commands are not accepted.",
      inputSchema: {
        project: z.string(),
        check: z.string(),
      },
    },
    async ({ project, check }) =>
      result(await callHome(env, "/verify", {
        method: "POST",
        body: JSON.stringify({ project, check }),
      })),
  );

  server.registerTool(
    "commandhud.data.evidence",
    {
      description: "Run the bounded Data Game evidence audit on the authenticated Windows workstation.",
      inputSchema: {
        scenario: z.literal("enemy-obstruction").default("enemy-obstruction"),
      },
    },
    async ({ scenario }) =>
      result(await callHome(env, "/data/evidence", {
        method: "POST",
        body: JSON.stringify({ scenario }),
      })),
  );
}
