import { timingSafeEqual } from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import {
  agentSession, applySandboxPatch, createSandboxJob, discardSandboxJob, discoverAgentHarnesses,
  discoverProjects, executeSandboxCommand, gitSnapshot, listAgentSessions, listSandboxJobs,
  readSandboxFile, resolveRegisteredProject, sandboxDiff, sandboxJobState, sandboxMediaArtifact, searchSandbox,
  startDetachedAgent, stopAgentSession,
} from "../../packages/commandhud/core.mjs";

const host = "127.0.0.1";
const port = Number(process.env.COMMANDHUD_HOME_PORT || 8788);
const token = process.env.COMMANDHUD_HOME_TOKEN;
const MAX_BODY = 300 * 1024;
const MAX_OUTPUT = 512 * 1024;
const RUN_ID = /^\d{14}-[0-9a-f]{4}$/i;

if (!token) throw new Error("COMMANDHUD_HOME_TOKEN is required.");

function authorized(request) {
  const actual = Buffer.from(request.headers.authorization || "");
  const expected = Buffer.from(`Bearer ${token}`);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function send(response, status, value) {
  const body = JSON.stringify(value);
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(body), "Cache-Control": "no-store" });
  response.end(body);
}

function sendMedia(response, artifact) {
  response.writeHead(200, {
    "Content-Type": artifact.mediaType,
    "Content-Length": artifact.byteLength,
    "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(artifact.name)}`,
    "Cache-Control": "no-store",
    "X-CommandHUD-Artifact-Id": artifact.id,
    "X-CommandHUD-Artifact-Sha256": artifact.sha256,
    "X-CommandHUD-Job-Id": artifact.jobId,
    "X-CommandHUD-Source-Head": artifact.head,
    "X-CommandHUD-Project": encodeURIComponent(artifact.project),
    "X-CommandHUD-Path": encodeURIComponent(artifact.path),
  });
  response.end(artifact.bytes);
}

async function bodyJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY) throw new Error("Request body is too large.");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

function remoteSession(value) {
  return value && {
    id: value.id, status: value.status, reason: value.reason, agent: value.agent,
    provider: value.provider, runtime: value.runtime, costClass: value.costClass,
    dataBoundary: value.dataBoundary, externalTransmission: value.externalTransmission,
    project: value.project, baseSha: value.baseSha, head: value.head, dirty: value.dirty,
    objective: value.objective, startedAt: value.startedAt, updatedAt: value.updatedAt,
    changedFiles: value.changedFiles, message: value.message,
  };
}

function remoteSandbox(value) {
  return value && {
    id: value.id, project: value.project, task: value.task, status: value.status,
    baseSha: value.baseSha, head: value.head ?? null, branch: value.branch ?? null,
    dirty: value.dirty ?? null, changedFiles: value.changedFiles || [],
    sourceAuthorityCurrent: value.sourceAuthorityCurrent ?? null,
    workspaceAvailable: value.workspaceAvailable, activeOperation: value.activeOperation ?? false,
    createdAt: value.createdAt, updatedAt: value.updatedAt,
    lastOperationId: value.lastOperationId, lastOperationKind: value.lastOperationKind,
    discardedAt: value.discardedAt || null,
  };
}

function boundedEvidence(path, limit) {
  if (!path || !existsSync(path)) return { text: "", truncated: false };
  const value = readFileSync(path, "utf8");
  return value.length <= limit ? { text: value, truncated: false } : { text: value.slice(-limit), truncated: true };
}

function remoteOperation(value) {
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
}

function run(file, args, cwd, timeoutMs = 120_000) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { cwd, windowsHide: true, shell: false, env: process.env });
    let stdout = "", stderr = "", truncated = false, settled = false;
    const append = (target, chunk) => {
      const text = chunk.toString();
      if (stdout.length + stderr.length + text.length > MAX_OUTPUT) { truncated = true; return; }
      if (target === "stdout") stdout += text; else stderr += text;
    };
    child.stdout.on("data", (chunk) => append("stdout", chunk));
    child.stderr.on("data", (chunk) => append("stderr", chunk));
    child.once("error", reject);
    const timer = setTimeout(() => { if (!settled) child.kill(); }, timeoutMs);
    child.once("close", (code, signal) => { settled = true; clearTimeout(timer); resolve({ code, signal, stdout: stdout.trimEnd(), stderr: stderr.trimEnd(), truncated }); });
  });
}

async function brokemanScript() {
  const project = (await discoverProjects()).find((candidate) => candidate.id === "indrolend/brokeman");
  if (!project?.root) throw new Error("The registered Brokeman project is unavailable.");
  const script = join(project.root, "brokeman.ps1");
  if (!existsSync(script)) throw new Error("The registered Brokeman entrypoint is unavailable.");
  return { root: project.root, script };
}

async function invokeBrokeman(command, job) {
  if (!RUN_ID.test(String(job || ""))) throw new Error("A valid CommandHUD job ID is required.");
  const authority = await brokemanScript();
  const result = await run("pwsh.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-File", authority.script, command, job, "-Json"], authority.root);
  if (result.code !== 0) throw new Error(`Brokeman ${command} failed: ${(result.stderr || result.stdout).slice(-2000)}`);
  try { return JSON.parse(result.stdout); } catch { throw new Error(`Brokeman ${command} returned malformed JSON.`); }
}

async function publishBrokemanPacket(job) {
  if (!RUN_ID.test(String(job || ""))) throw new Error("A valid CommandHUD job ID is required.");
  const authority = await brokemanScript();
  const published = await run("pwsh.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-File", authority.script, "packet", job], authority.root, 300_000);
  if (published.code !== 0) throw new Error(`Brokeman packet failed: ${(published.stderr || published.stdout).slice(-2000)}`);
  return invokeBrokeman("result", job);
}

async function watchBrokemanJob(job) {
  try {
    if (!RUN_ID.test(String(job || ""))) return false;
    const authority = await brokemanScript();
    const child = spawn("pwsh.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-File", authority.script, "watch", job, "-NotifyStarted"], {
      cwd: authority.root, detached: true, windowsHide: true, stdio: "ignore", env: process.env,
    });
    child.unref();
    return true;
  } catch { return false; }
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, "http://localhost");
    if (!authorized(request)) return send(response, 401, { error: "Unauthorized" });
    if (request.method === "GET" && url.pathname === "/health") return send(response, 200, { executor: "home-windows", status: "ready", capabilities: ["commandhud.lifecycle", "commandhud.sandbox", "commandhud.media", "brokeman.result", "brokeman.packet"] });
    if (request.method === "GET" && url.pathname === "/projects") {
      const projects = (await discoverProjects()).map(({ root, ...project }) => project);
      return send(response, 200, { executor: "home-windows", projects });
    }
    if (request.method === "GET" && url.pathname === "/agents") {
      await resolveRegisteredProject(url.searchParams.get("project"));
      return send(response, 200, { agents: await discoverAgentHarnesses() });
    }
    if (request.method === "GET" && url.pathname === "/project-state") {
      const selected = await resolveRegisteredProject(url.searchParams.get("project"));
      const git = await gitSnapshot(selected.root);
      return send(response, 200, { project: selected.identity.id, git, sandboxes: (await listSandboxJobs(selected, 25)).map(remoteSandbox), agents: listAgentSessions(selected, 25).map(remoteSession) });
    }
    if (request.method === "POST" && url.pathname === "/agents/start") {
      const { project, objective, expectedHead, agent = "codex/ollama", allowPaid = false } = await bodyJson(request);
      const selected = await resolveRegisteredProject(String(project || ""));
      const harnesses = await discoverAgentHarnesses();
      const harness = harnesses.find((candidate) => candidate.id === agent);
      if (!harness?.available) throw new Error("The selected CommandHUD agent is unavailable.");
      if (harness.dataBoundary === "external-provider" && allowPaid !== true) throw new Error("External-provider execution requires allowPaid=true.");
      const session = await startDetachedAgent(selected, String(objective || ""), { agent, expectedHead: String(expectedHead || "") });
      const continuityProjection = await watchBrokemanJob(session.id);
      return send(response, 202, { ...remoteSession(session), continuityProjection });
    }
    if (request.method === "GET" && url.pathname === "/agent-sessions") {
      const selected = await resolveRegisteredProject(url.searchParams.get("project"));
      const limit = Number(url.searchParams.get("limit") || 25);
      return send(response, 200, { sessions: listAgentSessions(selected, limit).map(remoteSession) });
    }
    const agentMatch = url.pathname.match(/^\/agents\/(\d{14}-[0-9a-f]{4})$/i);
    if (request.method === "GET" && agentMatch) {
      const selected = await resolveRegisteredProject(url.searchParams.get("project"));
      const session = agentSession(selected, agentMatch[1]);
      if (!session) throw new Error("Agent session was not found.");
      return send(response, 200, remoteSession(session));
    }
    const actionMatch = url.pathname.match(/^\/agents\/(\d{14}-[0-9a-f]{4})\/actions$/i);
    if (request.method === "POST" && actionMatch) {
      const { project, action } = await bodyJson(request);
      if (action !== "stop") throw new Error("Only the stop action is supported.");
      const selected = await resolveRegisteredProject(String(project || ""));
      return send(response, 200, stopAgentSession(selected, actionMatch[1]));
    }
    if (request.method === "POST" && url.pathname === "/sandboxes") {
      const { project, task, expectedHead } = await bodyJson(request);
      const selected = await resolveRegisteredProject(String(project || ""));
      return send(response, 201, remoteSandbox(await createSandboxJob(selected, task, { expectedHead: String(expectedHead || "") })));
    }
    if (request.method === "GET" && url.pathname === "/sandboxes") {
      const selected = await resolveRegisteredProject(url.searchParams.get("project"));
      const limit = Number(url.searchParams.get("limit") || 25);
      return send(response, 200, { sandboxes: (await listSandboxJobs(selected, limit)).map(remoteSandbox) });
    }
    const sandboxMatch = url.pathname.match(/^\/sandboxes\/(\d{14}-[0-9a-f]{4})$/i);
    if (request.method === "GET" && sandboxMatch) {
      const selected = await resolveRegisteredProject(url.searchParams.get("project"));
      return send(response, 200, remoteSandbox(await sandboxJobState(selected, sandboxMatch[1])));
    }
    const sandboxExecMatch = url.pathname.match(/^\/sandboxes\/(\d{14}-[0-9a-f]{4})\/exec$/i);
    if (request.method === "POST" && sandboxExecMatch) {
      const { project, argv, cwd = ".", timeoutMs = 120000 } = await bodyJson(request);
      const selected = await resolveRegisteredProject(String(project || ""));
      return send(response, 200, remoteOperation(await executeSandboxCommand(selected, sandboxExecMatch[1], argv, { cwd, timeoutMs })));
    }
    const sandboxReadMatch = url.pathname.match(/^\/sandboxes\/(\d{14}-[0-9a-f]{4})\/read$/i);
    if (request.method === "GET" && sandboxReadMatch) {
      const selected = await resolveRegisteredProject(url.searchParams.get("project"));
      return send(response, 200, readSandboxFile(selected, sandboxReadMatch[1], url.searchParams.get("path"), {
        startLine: Number(url.searchParams.get("startLine") || 1), endLine: Number(url.searchParams.get("endLine") || 200),
      }));
    }
    const sandboxMediaMatch = url.pathname.match(/^\/sandboxes\/(\d{14}-[0-9a-f]{4})\/media$/i);
    if (request.method === "GET" && sandboxMediaMatch) {
      const selected = await resolveRegisteredProject(url.searchParams.get("project"));
      const artifact = await sandboxMediaArtifact(selected, sandboxMediaMatch[1], url.searchParams.get("path"));
      return sendMedia(response, artifact);
    }
    const sandboxSearchMatch = url.pathname.match(/^\/sandboxes\/(\d{14}-[0-9a-f]{4})\/search$/i);
    if (request.method === "POST" && sandboxSearchMatch) {
      const { project, query, scope = "." } = await bodyJson(request);
      const selected = await resolveRegisteredProject(String(project || ""));
      const value = await searchSandbox(selected, sandboxSearchMatch[1], query, { scope });
      return send(response, 200, { operation: remoteOperation(value), matches: value.operation?.files || [] });
    }
    const sandboxPatchMatch = url.pathname.match(/^\/sandboxes\/(\d{14}-[0-9a-f]{4})\/patch$/i);
    if (request.method === "POST" && sandboxPatchMatch) {
      const { project, patch } = await bodyJson(request);
      const selected = await resolveRegisteredProject(String(project || ""));
      return send(response, 200, remoteOperation(await applySandboxPatch(selected, sandboxPatchMatch[1], patch)));
    }
    const sandboxDiffMatch = url.pathname.match(/^\/sandboxes\/(\d{14}-[0-9a-f]{4})\/diff$/i);
    if (request.method === "POST" && sandboxDiffMatch) {
      const { project } = await bodyJson(request);
      const selected = await resolveRegisteredProject(String(project || ""));
      return send(response, 200, remoteOperation(await sandboxDiff(selected, sandboxDiffMatch[1])));
    }
    const sandboxActionMatch = url.pathname.match(/^\/sandboxes\/(\d{14}-[0-9a-f]{4})\/actions$/i);
    if (request.method === "POST" && sandboxActionMatch) {
      const { project, action } = await bodyJson(request);
      if (action !== "discard") throw new Error("Only the discard sandbox action is supported.");
      const selected = await resolveRegisteredProject(String(project || ""));
      return send(response, 200, remoteSandbox(await discardSandboxJob(selected, sandboxActionMatch[1])));
    }
    if (request.method === "GET" && url.pathname === "/brokeman/result") return send(response, 200, await invokeBrokeman("result", url.searchParams.get("job")));
    if (request.method === "POST" && url.pathname === "/brokeman/packet") {
      const { job } = await bodyJson(request);
      return send(response, 200, await publishBrokemanPacket(job));
    }
    return send(response, 404, { error: "Not found" });
  } catch (error) {
    return send(response, 400, { error: error instanceof Error ? error.message : String(error) });
  }
});

server.listen(port, host, () => console.log(`CommandHUD home executor listening on http://${host}:${port}`));
