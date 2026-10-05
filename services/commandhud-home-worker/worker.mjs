import { timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { discoverProjects } from "../../packages/commandhud/core.mjs";

const host = "127.0.0.1";
const port = Number(process.env.COMMANDHUD_HOME_PORT || 8788);
const token = process.env.COMMANDHUD_HOME_TOKEN;
const MAX_OUTPUT = 256 * 1024;
const VERIFY_ALLOW = new Set(["test", "typecheck", "build", "lint", "check"]);

if (!token) throw new Error("COMMANDHUD_HOME_TOKEN is required.");

function authorized(request) {
  const header = request.headers.authorization || "";
  const expected = `Bearer ${token}`;
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function send(response, status, value) {
  const body = JSON.stringify(value, null, 2);
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(body) });
  response.end(body);
}

async function bodyJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 64 * 1024) throw new Error("Request body too large.");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

async function projectTable() {
  const projects = await discoverProjects();
  return new Map(projects.map((p) => [String(p.name), p]));
}

async function resolveProject(name) {
  if (!name) throw new Error("project is required");
  const table = await projectTable();
  const project = table.get(String(name));
  if (!project?.root) throw new Error("Unknown project.");
  return project;
}

function run(file, args, cwd, timeoutMs = 30_000) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { cwd, windowsHide: true, shell: false, env: process.env });
    let stdout = "", stderr = "", truncated = false, done = false;
    const append = (which, chunk) => {
      const text = chunk.toString();
      if (stdout.length + stderr.length + text.length > MAX_OUTPUT) {
        truncated = true;
        return;
      }
      if (which === "out") stdout += text; else stderr += text;
    };
    child.stdout.on("data", (c) => append("out", c));
    child.stderr.on("data", (c) => append("err", c));
    const timer = setTimeout(() => {
      if (!done) child.kill();
    }, timeoutMs);
    child.on("error", reject);
    child.on("close", (code, signal) => {
      done = true; clearTimeout(timer);
      resolve({ code, signal, stdout: stdout.trimEnd(), stderr: stderr.trimEnd(), truncated });
    });
  });
}

async function git(root, args) {
  return run("git", args, root);
}

async function repoStatus(project) {
  const p = await resolveProject(project);
  const [head, branch, upstream, status] = await Promise.all([
    git(p.root, ["rev-parse", "HEAD"]),
    git(p.root, ["branch", "--show-current"]),
    git(p.root, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]),
    git(p.root, ["status", "--short", "--branch"]),
  ]);
  return {
    project: p.name,
    head: head.code === 0 ? head.stdout : null,
    branch: branch.stdout || null,
    upstream: upstream.code === 0 ? upstream.stdout : null,
    clean: status.stdout.split(/\r?\n/).slice(1).filter(Boolean).length === 0,
    status: status.stdout,
  };
}

async function declaredScript(root, check) {
  if (!VERIFY_ALLOW.has(check)) throw new Error("Check is not allowlisted.");
  const packagePath = join(root, "package.json");
  let pkg;
  try { pkg = JSON.parse(await readFile(packagePath, "utf8")); } catch { throw new Error("Project has no readable package.json."); }
  if (!pkg.scripts?.[check]) throw new Error(`Project does not declare npm script "${check}".`);
  return pkg.scripts[check];
}


async function runDataEvidence(scenario) {
  if (scenario !== "enemy-obstruction") throw new Error("Unsupported evidence scenario.");

  const toolsRoot = "C:\\Users\\indro\\Projects\\data-game-tools";
  const script = join(toolsRoot, "Invoke-DataGame.ps1");

  const r = await run(
    "pwsh.exe",
    [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-File",
      script,
      "-Action",
      "evidence",
      "-Scenario",
      scenario,
    ],
    toolsRoot,
    10 * 60_000,
  );

  if (r.code !== 0) {
    throw new Error(
      "Data evidence failed: " +
      (r.stderr || r.stdout || ("exit " + r.code)).slice(-4000)
    );
  }

  const match = r.stdout.match(/EVIDENCE_OK\s+bundle=(.+?)\s+result=(.+?)\s+video=(.+?)(?:\r?\n|$)/);
  if (!match) throw new Error("Evidence completed without an EVIDENCE_OK result marker.");

  const bundle = match[1].trim();
  const resultPath = match[2].trim();

  const parsed = JSON.parse(await readFile(resultPath, "utf8"));
  const toolsPrefix = toolsRoot.replace(/[\\/]+$/, "") + "\\";

  const artifact = (name) => {
    const full = join(bundle, name);
    return {
      relative: full.startsWith(toolsPrefix)
        ? full.slice(toolsPrefix.length).replace(/\\/g, "/")
        : name,
      machine: full,
    };
  };

  return {
    classification: parsed.classification,
    scenario: parsed.scenario ?? scenario,
    game_commit: parsed.game_commit ?? parsed.commit ?? parsed.revision,
    game_dirty: parsed.game_dirty ?? parsed.dirty,
    configuration: parsed.configuration,
    ticks: parsed.ticks ?? parsed.tick_count,
    telemetry_rows: parsed.telemetry_rows,
    video_source_frames: parsed.video_source_frames ?? parsed.frame_count,
    video_sha256: parsed.video_sha256,
    bundle: {
      relative: bundle.startsWith(toolsPrefix)
        ? bundle.slice(toolsPrefix.length).replace(/\\/g, "/")
        : bundle,
      machine: bundle,
    },
    artifacts: {
      result: artifact("result.json"),
      manifest: artifact(parsed.manifest || "manifest.json"),
      timeline: artifact(parsed.timeline || "timeline.ndjson"),
      events: artifact(parsed.events || "events.ndjson"),
      assertions: artifact(parsed.assertions || "assertions.json"),
      video: artifact(parsed.video || "evidence.mp4"),
    },
  };
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, "http://localhost");
    if (!authorized(request)) return send(response, 401, { error: "Unauthorized" });

    if (request.method === "GET" && url.pathname === "/health")
      return send(response, 200, { executor: "home-windows", status: "ready" });

    if (request.method === "GET" && url.pathname === "/projects") {
      const projects = (await discoverProjects()).map(({ root, ...project }) => project);
      return send(response, 200, { executor: "home-windows", capability: "commandhud.projects", projects });
    }

    if (request.method === "GET" && url.pathname === "/repo/status")
      return send(response, 200, await repoStatus(url.searchParams.get("project")));

    if (request.method === "GET" && url.pathname === "/repo/log") {
      const p = await resolveProject(url.searchParams.get("project"));
      const count = Math.max(1, Math.min(50, Number(url.searchParams.get("count") || 15)));
      const r = await git(p.root, ["log", `-${count}`, "--date=iso-strict", "--pretty=format:%H%x09%ad%x09%s"]);
      return send(response, r.code === 0 ? 200 : 500, { project: p.name, ...r });
    }

    if (request.method === "GET" && url.pathname === "/repo/diff") {
      const p = await resolveProject(url.searchParams.get("project"));
      const r = await git(p.root, ["diff", "--no-ext-diff", "--"]);
      return send(response, r.code === 0 ? 200 : 500, { project: p.name, ...r });
    }

    if (request.method === "GET" && url.pathname === "/source/search") {
      const p = await resolveProject(url.searchParams.get("project"));
      const q = url.searchParams.get("q") || "";
      if (!q || q.length > 500) throw new Error("q must be 1..500 characters.");
      const max = Math.max(1, Math.min(200, Number(url.searchParams.get("max") || 50)));
      const r = await run("rg", ["--line-number", "--no-heading", "--color", "never", "--max-count", String(max), "--", q, "."], p.root);
      return send(response, r.code === 0 || r.code === 1 ? 200 : 500, { project: p.name, query: q, ...r });
    }


    if (request.method === "POST" && url.pathname === "/data/evidence") {
      const { scenario = "enemy-obstruction" } = await bodyJson(request);
      const result = await runDataEvidence(String(scenario));
      return send(response, 200, result);
    }

    if (request.method === "POST" && url.pathname === "/verify") {
      const { project, check } = await bodyJson(request);
      const p = await resolveProject(project);
      await declaredScript(p.root, String(check));
      const r = await run(process.platform === "win32" ? "npm.cmd" : "npm", ["run", String(check), "--", "--"], p.root, 120_000);
      return send(response, 200, { project: p.name, check, ok: r.code === 0, ...r });
    }

    return send(response, 404, { error: "Not found" });
  } catch (error) {
    return send(response, 400, { error: error instanceof Error ? error.message : String(error) });
  }
});

server.listen(port, host, () => {
  console.log(`CommandHUD home executor listening on http://${host}:${port}`);
});
