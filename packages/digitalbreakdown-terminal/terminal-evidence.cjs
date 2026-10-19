#!/usr/bin/env node
const { createCommandHudReader } = require("./commandhud-adapter.cjs");

function usage() {
  return [
    "dbt-evidence list [limit]",
    "dbt-evidence tail <run-id> [count]",
    "Read-only CommandHUD projection; no command execution or raw evidence mode."
  ].join("\n");
}

function positiveInteger(value, fallback) {
  const parsed = Number(value ?? fallback);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

async function main(argv = process.argv.slice(2), reader = createCommandHudReader()) {
  const [action = "list", argument, count] = argv;
  if (action === "help" || action === "--help" || action === "-h") return usage();
  if (action === "list") {
    const snapshot = await reader.snapshot(positiveInteger(argument, 8));
    const repository = snapshot.repository;
    const rows = snapshot.operations.map(operation => [
      operation.runId, String(operation.status || "unknown").toUpperCase(),
      operation.type || "operation", operation.result || "result unknown",
      `evidence=${operation.evidence || "UNKNOWN"}`
    ].join(" · "));
    return [`COMMANDHUD ${repository.name} · ${repository.branch ?? "branch unknown"} · ${repository.head?.slice(0, 12) ?? "HEAD unknown"}`, ...rows].join("\n");
  }
  if (action === "tail") {
    if (!argument) throw new Error(`Missing retained run identity.\n${usage()}`);
    const projection = await reader.evidence(argument, { mode: "tail", count: positiveInteger(count, 20) });
    const lines = [`RUN ${projection.runId} · ${String(projection.status).toUpperCase()} · exit ${projection.exitCode ?? "unknown"} · TAIL ${projection.count}`];
    for (const stream of projection.streams) {
      lines.push(`${stream.stream.toUpperCase()} · ${stream.totalLines ?? "?"} lines${stream.truncated ? " · bounded" : ""}`);
      for (const line of stream.lines) lines.push(typeof line === "string" ? line : line.text);
    }
    return lines.join("\n");
  }
  throw new Error(`Unknown dbt-evidence action: ${action}.\n${usage()}`);
}

if (require.main === module) {
  main().then(value => process.stdout.write(`${value}\n`)).catch(error => {
    process.stderr.write(`dbt-evidence: ${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = { main, usage };
