export function decodeContextPayload(encoded) {
  if (typeof encoded !== "string" || !encoded) return null;
  try {
    const bytes = Uint8Array.from(atob(encoded), character => character.charCodeAt(0));
    const value = JSON.parse(new TextDecoder().decode(bytes));
    if (!value || typeof value.cwd !== "string") return null;
    return Object.freeze({
      cwd: value.cwd,
      repository: typeof value.repository === "string" ? value.repository : null,
      repositoryRoot: typeof value.repositoryRoot === "string" ? value.repositoryRoot : null,
      branch: typeof value.branch === "string" ? value.branch : null,
      dirty: value.dirty === true,
      exitCode: Number.isInteger(value.exitCode) ? value.exitCode : null,
      shell: typeof value.shell === "string" ? value.shell : "PowerShell"
    });
  } catch {
    return null;
  }
}

export function compactPath(cwd, repositoryRoot, home) {
  if (!cwd) return "LOCATION UNKNOWN";
  const insensitive = value => String(value).replaceAll("\\", "/").toLowerCase();
  const normalized = String(cwd).replaceAll("\\", "/");
  if (repositoryRoot && insensitive(normalized).startsWith(insensitive(repositoryRoot))) {
    const root = String(repositoryRoot).replaceAll("\\", "/");
    const suffix = normalized.slice(root.length).replace(/^\/+/, "");
    const name = root.split("/").filter(Boolean).at(-1) || root;
    return suffix ? `${name}/${suffix}` : name;
  }
  if (home && insensitive(normalized).startsWith(insensitive(home))) {
    return `~${normalized.slice(String(home).replaceAll("\\", "/").length) || "/"}`;
  }
  return normalized;
}

export function contextView(context, options = {}) {
  const connected = options.connected === true;
  const evidenceAvailable = options.evidenceAvailable === true;
  const execution = options.execution || "ready";
  const location = compactPath(context?.cwd, context?.repositoryRoot, options.home);
  const repository = context?.repository ? `REPORTED ${context.repository}` : "NO REPOSITORY";
  const branch = context?.branch ? `REPORTED ${context.branch}` : "NO BRANCH";
  const dirty = context?.repository ? (context.dirty ? "REPORTED DIRTY" : "REPORTED CLEAN") : "DETACHED";
  const exit = context?.exitCode === null || context?.exitCode === undefined
    ? "EXIT —"
    : `REPORTED EXIT ${context.exitCode}`;
  return Object.freeze({
    location,
    repository,
    branch,
    dirty,
    connection: connected ? "SIGNAL ACTIVE" : "SIGNAL LOST",
    evidence: evidenceAvailable ? "EVIDENCE READY" : "EVIDENCE QUIET",
    execution: execution.toUpperCase(),
    exit,
    shell: context?.shell || "PowerShell"
  });
}
