const { existsSync } = require("node:fs");
const { resolve } = require("node:path");
const { pathToFileURL } = require("node:url");

// Default to the owning checkout; a different project requires an explicit override.
const DEFAULT_ROOT = resolve(__dirname, "..", "..");
const DEFAULT_CORE = resolve(__dirname, "..", "commandhud", "core.mjs");

function projectKey(identity) {
  return String(identity?.id || "").replace(/[^a-z0-9_-]+/gi, "_").toLowerCase();
}

function boundedLimit(value, fallback = 8) {
  const parsed = Number(value ?? fallback);
  return Number.isInteger(parsed) ? Math.max(1, Math.min(25, parsed)) : fallback;
}

function evidenceMode(value) {
  return ["head", "tail"].includes(value) ? value : "tail";
}

function configuration(env = process.env) {
  return { root: resolve(env.DB_COMMANDHUD_ROOT || DEFAULT_ROOT), core: resolve(env.DB_COMMANDHUD_CORE || DEFAULT_CORE) };
}

function createCommandHudReader({ env = process.env, load = url => import(url) } = {}) {
  const configured = configuration(env);
  let projectPromise = null;
  async function project() {
    if (!projectPromise) projectPromise = (async () => {
      if (!existsSync(configured.core)) throw new Error("CommandHUD core is unavailable.");
      if (!existsSync(configured.root)) throw new Error("Configured CommandHUD project is unavailable.");
      const core = await load(pathToFileURL(configured.core).href);
      const verified = await core.verifyRoot(configured.root);
      return { core, project: { ...verified, store: core.stateRoot(env), key: projectKey(verified.identity) } };
    })();
    return projectPromise;
  }
  return Object.freeze({
    async snapshot(limit) {
      const { core, project: source } = await project();
      const [currency, history] = await Promise.all([
        core.repositoryCurrency(source.root, source.identity.id), core.operationHistory(source, boundedLimit(limit))
      ]);
      return Object.freeze({
        sourceSystem: "commandhud",
        repository: Object.freeze({ identity: source.identity.id, name: source.identity.name, branch: currency.branch ?? null, head: currency.head ?? null, dirty: currency.dirty ?? null }),
        operations: Object.freeze(history.map(entry => Object.freeze({ runId: entry.runId, type: entry.type, status: entry.status, startedAt: entry.startedAt, durationMs: entry.durationMs, evidence: entry.evidence, result: entry.result, reversible: entry.reversible })))
      });
    },
    async evidence(runId, { mode, count } = {}) {
      if (!/^[a-zA-Z0-9_-]+$/.test(String(runId || ""))) throw new Error("Invalid retained evidence identity.");
      const { core, project: source } = await project();
      // CommandHUD validates both the immutable run identity and evidence paths.
      // This adapter deliberately exposes only bounded line projections, never commands.
      const projection = core.projectRunEvidence(source, runId, { mode: evidenceMode(mode), count: boundedLimit(count, 40) });
      return Object.freeze({
        sourceSystem: "commandhud",
        runId: projection.runId,
        status: projection.status,
        exitCode: projection.exitCode,
        mode: projection.mode,
        count: projection.count,
        streams: Object.freeze(projection.streams.map(stream => Object.freeze({
          stream: stream.stream,
          totalLines: stream.totalLines,
          truncated: Boolean(stream.truncated),
          lines: Object.freeze(stream.lines || [])
        })))
      });
    }
  });
}

module.exports = { boundedLimit, configuration, createCommandHudReader, evidenceMode, projectKey };
