import { Terminal } from "/node_modules/@xterm/xterm/lib/xterm.mjs";
import { FitAddon } from "/node_modules/@xterm/addon-fit/lib/addon-fit.mjs";
import { createObservationStream, classifyInput } from "/observation-model.mjs";
import { createClipboardProjection, clipboardObservedState } from "/clipboard-projection.mjs";
import { runFunctionalThenObserve, safeVisualCall } from "/functional-boundary.mjs";
import { contextView, decodeContextPayload } from "/context-projection.mjs";
import { createCursorInteraction } from "/cursor-interaction.mjs";
import { createJellyOverlay } from "/jelly-overlay.mjs";

const sessionIdentity = crypto.randomUUID();
const visualsEnabled = new URLSearchParams(location.search).get("visuals") !== "off";
let visualObserver = () => {};
let semanticMorph = Object.freeze({ play() {}, stop() {} });
let shellContext = null;
let connected = false;
let evidenceAvailable = false;
let executionState = "ready";
const observations = createObservationStream({
  sessionIdentity,
  onEvent: event => visualObserver(event)
});

function observeOptional(eventType, observedState, options) {
  try {
    return observations.observe(eventType, observedState, options);
  } catch {
    return null;
  }
}

function enableOptionalVisuals() {
  if (!visualsEnabled) return;
  void import("/buoyant-canvas.mjs").then(({ createBuoyantCanvas }) => {
    try {
      const canvas = createBuoyantCanvas(document.getElementById("buoyant-field"));
      visualObserver = event => safeVisualCall(canvas, "observe", event);
    } catch {
      visualObserver = () => {};
    }
  }).catch(() => {});
  void import("/semantic-morph.mjs").then(({ createSemanticMorph }) => {
    try {
      semanticMorph = createSemanticMorph(document.getElementById("semantic-morph-layer"));
    } catch {
      semanticMorph = Object.freeze({ play() {}, stop() {} });
    }
  }).catch(() => {});
}

const terminal = new Terminal({
  cursorBlink: true,
  allowTransparency: true,
  fontFamily: '"Cascadia Mono", "Cascadia Code", Consolas, monospace',
  fontSize: 16,
  lineHeight: 1.15,
  letterSpacing: 0,
  scrollback: 10000,
  theme: {
    background: "rgba(0, 25, 29, 0.88)",
    foreground: "#72e6c7",
    cursor: "#74ffbd",
    selectionBackground: "#28666d",
    black: "#00191d", red: "#ff657a", green: "#74ffbd", yellow: "#f1c86a",
    blue: "#58aeb0", magenta: "#df70df", cyan: "#72e6c7", white: "#d9fff4",
    brightBlack: "#38666b", brightRed: "#ff8b9b", brightGreen: "#a0ffd1", brightYellow: "#ffe19a",
    brightBlue: "#82cfd1", brightMagenta: "#f09cf0", brightCyan: "#a2f9e2", brightWhite: "#ffffff"
  }
});

const fit = new FitAddon();
terminal.loadAddon(fit);

terminal.open(document.getElementById("terminal"));
fit.fit();
terminal.focus();

const jellyToggle = document.getElementById("jelly-toggle");
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
const jellyOverlay = createJellyOverlay({ host: document.getElementById("terminal"), terminal });
function setJellyEnabled(enabled) {
  jellyOverlay.setEnabled(visualsEnabled && !reducedMotion.matches && enabled);
  jellyToggle.setAttribute("aria-pressed", String(jellyOverlay.enabled));
  jellyToggle.textContent = jellyOverlay.enabled ? "JELLY ON" : "JELLY OFF";
}
setJellyEnabled(visualsEnabled && !reducedMotion.matches);
jellyToggle.disabled = !visualsEnabled || reducedMotion.matches;
jellyToggle.addEventListener("click", () => setJellyEnabled(!jellyOverlay.enabled));
reducedMotion.addEventListener("change", () => {
  jellyToggle.disabled = !visualsEnabled || reducedMotion.matches;
  setJellyEnabled(!reducedMotion.matches);
});

const copyRaw = document.getElementById("copy-raw");
const copyFenced = document.getElementById("copy-fenced");
const paste = document.getElementById("paste");
const cursorInteraction = createCursorInteraction({ host: document.getElementById("terminal"), terminal, status: message => { document.getElementById("copy-status").textContent = message; }, observe: observeOptional });
const copyStatus = document.getElementById("copy-status");
const evidenceToggle = document.getElementById("evidence-toggle");
const evidencePanel = document.getElementById("evidence-panel");
const evidenceClose = document.getElementById("evidence-close");
const evidenceRepository = document.getElementById("evidence-repository");
const evidenceList = document.getElementById("evidence-list");
const evidenceDetail = document.getElementById("evidence-detail");
const evidenceDetailTitle = document.getElementById("evidence-detail-title");
const evidenceDetailBody = document.getElementById("evidence-detail-body");
const evidenceDetailClose = document.getElementById("evidence-detail-close");
const contextLocation = document.getElementById("context-location");
const contextRepository = document.getElementById("context-repository");
const contextBranch = document.getElementById("context-branch");
const contextDirty = document.getElementById("context-dirty");
const connectionStatus = document.getElementById("connection-status");
const evidenceStatus = document.getElementById("evidence-status");
const executionStatus = document.getElementById("execution-status");
const exitStatus = document.getElementById("exit-status");
const shellStatus = document.getElementById("shell-status");
const signalSession = document.getElementById("signal-session");
const signalExecution = document.getElementById("signal-execution");
const signalLocation = document.getElementById("signal-location");
const signalBranch = document.getElementById("signal-branch");
const signalDirty = document.getElementById("signal-dirty");
const signalEvent = document.getElementById("signal-event");

function renderContext() {
  const view = contextView(shellContext, { connected, evidenceAvailable, execution: executionState });
  contextLocation.textContent = view.location;
  contextLocation.title = shellContext?.cwd || view.location;
  contextRepository.textContent = view.repository;
  contextBranch.textContent = view.branch;
  contextDirty.textContent = view.dirty;
  contextDirty.dataset.state = view.dirty.toLowerCase();
  connectionStatus.textContent = view.connection;
  connectionStatus.dataset.state = connected ? "active" : "lost";
  evidenceStatus.textContent = view.evidence;
  executionStatus.textContent = view.execution;
  exitStatus.textContent = view.exit;
  exitStatus.dataset.state = shellContext?.exitCode === 0 ? "success" : shellContext?.exitCode ? "error" : "idle";
  shellStatus.textContent = view.shell;
}

terminal.parser.registerOscHandler(777, encoded => {
  const decoded = decodeContextPayload(encoded);
  if (!decoded) return false;
  shellContext = decoded;
  executionState = "ready";
  renderContext();
  return true;
});

function selectedText() {
  return terminal.hasSelection() ? terminal.getSelection() : "";
}

function reportClipboardStatus(message) {
  copyStatus.textContent = message;
}

terminal.onSelectionChange(() => {
  const text = selectedText();
  copyRaw.disabled = !text;
  copyFenced.disabled = !text;
  reportClipboardStatus(text ? `${text.length} CH SELECTED` : "NO SELECTION");
  observeOptional("clipboard.selection", { length: text.length });
});

async function copySelection(mode) {
  const text = selectedText();
  if (!text) return;
  const projection = createClipboardProjection(text, mode);
  try {
    await navigator.clipboard.writeText(projection);
    observeOptional("clipboard.copy", clipboardObservedState(mode, projection));
    reportClipboardStatus(`${mode.toUpperCase()} COPIED`);
    cursorInteraction.copied('TEXT');
    terminal.focus();
  } catch {
    reportClipboardStatus("COPY BLOCKED");
  }
}

copyRaw.addEventListener("click", () => copySelection("raw"));
copyFenced.addEventListener("click", () => copySelection("fenced"));
paste.addEventListener("click", async () => {
  try {
    const text = await navigator.clipboard.readText();
    terminal.paste(text);
    observeOptional("clipboard.paste", clipboardObservedState("raw", text));
    reportClipboardStatus(`${text.length} CH PASTED`);
    terminal.focus();
  } catch {
    reportClipboardStatus("PASTE BLOCKED");
  }
});

function renderEvidence(snapshot) {
  evidenceList.replaceChildren();
  if (!snapshot?.repository) {
	 evidenceAvailable = false;
	 renderContext();
    evidenceRepository.textContent = snapshot?.reason || "Read-only evidence is unavailable.";
    return;
  }
  const repository = snapshot.repository;
	 evidenceAvailable = true;
	 renderContext();
  evidenceRepository.textContent = `${repository.name} · ${repository.branch ?? "branch unknown"} · ${repository.head?.slice(0, 12) ?? "HEAD unknown"}`;
  for (const operation of snapshot.operations ?? []) {
    observeOptional("commandhud.operation", {
      type: operation.type ?? null,
      status: operation.status ?? null,
      evidence: operation.evidence ?? null,
      durationMs: operation.durationMs ?? null
    }, {
      sourceRecordIdentity: operation.runId ?? null,
      verificationStatus: "unverified",
      historicalReplay: true
    });
    const item = document.createElement("li");
    const title = document.createElement("strong");
    title.textContent = `${operation.type} · ${String(operation.status || "unknown").toUpperCase()}`;
    const detail = document.createElement("div");
    detail.textContent = `${operation.result ?? "result unknown"} · evidence ${operation.evidence ?? "UNKNOWN"}`;
    const expand = document.createElement("button");
    expand.type = "button";
    expand.className = "evidence-expand";
    expand.textContent = "EXPAND";
    expand.addEventListener("click", () => expandEvidence(operation, item, expand));
    item.append(title, detail, expand);
    evidenceList.append(item);
  }
  if (!evidenceList.childElementCount) evidenceRepository.textContent += " · no retained operations";
}

function renderEvidenceText(projection) {
  evidenceDetailBody.replaceChildren();
  for (const stream of projection.streams ?? []) {
    const heading = document.createElement("h3");
    heading.textContent = `${stream.stream.toUpperCase()} · ${stream.totalLines ?? "?"} LINES${stream.truncated ? " · BOUNDED" : ""}`;
    const content = document.createElement("pre");
    content.textContent = (stream.lines ?? []).map(line => typeof line === "string" ? line : line.text).join("\n") || "[no retained output]";
    evidenceDetailBody.append(heading, content);
  }
}

async function expandEvidence(operation, source, trigger) {
  if (!operation.runId) return;
  trigger.disabled = true;
  try {
    const response = await fetch(`/api/commandhud/evidence/${encodeURIComponent(operation.runId)}?mode=tail&count=40`);
    if (!response.ok) throw new Error("Retained evidence is unavailable.");
    const projection = await response.json();
    evidenceDetail.hidden = false;
    evidenceDetailTitle.textContent = `${operation.type ?? "OPERATION"} · ${operation.runId}`;
    renderEvidenceText(projection);
    const expanded = `${projection.streams?.reduce((sum, stream) => sum + (stream.totalLines || 0), 0) ?? 0} retained lines`;
    safeVisualCall(semanticMorph, "play", { from: `${operation.type ?? "operation"} · ${operation.status ?? "unknown"}`, to: expanded, source, target: evidenceDetail });
    observeOptional("commandhud.evidence.expanded", { mode: projection.mode, count: projection.count }, {
      sourceRecordIdentity: projection.runId,
      verificationStatus: "unverified",
      historicalReplay: true
    });
  } catch {
    evidenceDetail.hidden = false;
    evidenceDetailTitle.textContent = "RETAINED EVIDENCE";
    evidenceDetailBody.textContent = "Retained evidence is unavailable.";
  } finally {
    trigger.disabled = false;
  }
}

async function refreshEvidence() {
  evidenceRepository.textContent = "Loading read-only projection…";
  evidenceList.replaceChildren();
  try {
    const response = await fetch("/api/commandhud?limit=8");
    renderEvidence(await response.json());
  } catch {
    renderEvidence({ reason: "Read-only evidence is unavailable." });
  }
}

function setEvidenceOpen(open) {
  evidencePanel.hidden = !open;
  evidenceToggle.setAttribute("aria-expanded", String(open));
  if (open) refreshEvidence();
}

evidenceToggle.addEventListener("click", () => setEvidenceOpen(evidencePanel.hidden));
evidenceClose.addEventListener("click", () => setEvidenceOpen(false));
evidenceDetailClose.addEventListener("click", () => {
  safeVisualCall(semanticMorph, "stop");
  evidenceDetail.hidden = true;
});

const protocol = location.protocol === "https:" ? "wss:" : "ws:";
let traceSocket = null;
let signalSocket = null;

function socketUrl(sessionId, display) {
  return `${protocol}//${location.host}/terminal?session=${encodeURIComponent(sessionId)}&display=${display}`;
}

function updateSignal(event) {
  if (event.state) {
    const state = event.state;
    const context = state.context;
    signalExecution.textContent = String(state.execution || "unknown").toUpperCase();
    signalLocation.textContent = context?.cwd || "UNKNOWN";
    signalBranch.textContent = context?.branch || "UNKNOWN";
    signalDirty.textContent = context?.repository ? (context.dirty ? "DIRTY" : "CLEAN") : "UNKNOWN";
  }
  if (event.sequence !== undefined) signalEvent.textContent = `${event.sequence} · ${event.type}`;
}

function terminalEvent(raw) {
  let event;
  try { event = JSON.parse(raw); } catch {
    terminal.write(raw);
    return;
  }
  if (event.type === "session.snapshot") {
    if (event.outputTruncated) terminal.writeln("\r\n[EARLIER OUTPUT TRUNCATED]\r\n");
    if (event.output) terminal.write(event.output);
    updateSignal(event);
  } else if (event.type === "terminal.output") {
    runFunctionalThenObserve(
      () => terminal.write(event.data),
      () => observeOptional("terminal.output", { length: String(event.data).length })
    );
  } else if (event.type === "signal.state" || event.type === "session.exited") {
    updateSignal(event);
  }
}

function connectTrace(sessionId) {
  traceSocket = new WebSocket(socketUrl(sessionId, "trace"));
  traceSocket.addEventListener("open", () => {
	connected = true;
	renderContext();
  traceSocket.send(JSON.stringify({
    type: "resize",
    cols: terminal.cols,
    rows: terminal.rows
  }));
  observeOptional("session.connected", { transport: "websocket" });
  });

  traceSocket.addEventListener("message", event => terminalEvent(event.data));

  traceSocket.addEventListener("close", () => {
	connected = false;
	executionState = "disconnected";
	renderContext();
  terminal.writeln("\r\n[SESSION DISCONNECTED]");
  observeOptional("session.disconnected", { transport: "websocket" });
  });
}

function connectSignal(sessionId) {
  signalSession.textContent = sessionId;
  signalSocket = new WebSocket(socketUrl(sessionId, "signal"));
  signalSocket.addEventListener("message", message => {
    try { updateSignal(JSON.parse(message.data)); } catch {}
  });
  signalSocket.addEventListener("close", () => { signalExecution.textContent = "DISCONNECTED"; });
}

terminal.onData(data => {
	if (data.includes("\r")) {
		executionState = "running";
		renderContext();
	}
  if (traceSocket?.readyState === WebSocket.OPEN) {
    runFunctionalThenObserve(
      () => traceSocket.send(JSON.stringify({ type: "input", data })),
      () => observeOptional("terminal.input", { kind: classifyInput(data), length: data.length })
    );
  }
});

function resize() {
  fit.fit();
  document.getElementById("terminal").style.setProperty("--terminal-cols", terminal.cols);
  document.getElementById("terminal").style.setProperty("--terminal-rows", terminal.rows);
  if (traceSocket?.readyState === WebSocket.OPEN) {
    traceSocket.send(JSON.stringify({
      type: "resize",
      cols: terminal.cols,
      rows: terminal.rows
    }));
  }
  observeOptional("terminal.resize", { cols: terminal.cols, rows: terminal.rows });
}

new ResizeObserver(resize).observe(document.getElementById("terminal"));
window.addEventListener("resize", resize);
resize();
enableOptionalVisuals();
renderContext();
void refreshEvidence();
void (async () => {
  let id = sessionStorage.getItem("indro.session");
  if (!id) {
    const response = await fetch("/api/session");
    id = (await response.json()).sessionId;
    sessionStorage.setItem("indro.session", id);
  }
  connectTrace(id);
  connectSignal(id);
})().catch(() => terminal.writeln("\r\n[SESSION CONNECTION FAILED]"));

