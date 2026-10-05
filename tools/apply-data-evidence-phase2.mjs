import { readFile, writeFile } from "node:fs/promises";

const path = "services/commandhud-home-worker/worker.mjs";
let s = await readFile(path, "utf8");

if (!s.includes("async function runDataEvidence(")) {
  const marker = "const server = createServer(async (request, response) => {";

  const helper = String.raw`
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

`;

  if (!s.includes(marker)) throw new Error("home worker insertion marker not found");
  s = s.replace(marker, helper + marker);
}

if (!s.includes('url.pathname === "/data/evidence"')) {
  const marker = '    if (request.method === "POST" && url.pathname === "/verify") {';

  const route = String.raw`
    if (request.method === "POST" && url.pathname === "/data/evidence") {
      const { scenario = "enemy-obstruction" } = await bodyJson(request);
      const result = await runDataEvidence(String(scenario));
      return send(response, 200, result);
    }

`;

  if (!s.includes(marker)) throw new Error("verify route insertion marker not found");
  s = s.replace(marker, route + marker);
}

await writeFile(path, s);
