import { Terminal } from "/node_modules/@xterm/xterm/lib/xterm.mjs";
import { FitAddon } from "/node_modules/@xterm/addon-fit/lib/addon-fit.mjs";
import { createObservationStream, classifyInput } from "/observation-model.mjs";
import { createClipboardProjection, clipboardObservedState } from "/clipboard-projection.mjs";
import { runFunctionalThenObserve, safeVisualCall } from "/functional-boundary.mjs";

const sessionIdentity = crypto.randomUUID();
const visualsEnabled = new URLSearchParams(location.search).get("visuals") !== "off";
let visualObserver = () => {};
let semanticMorph = Object.freeze({ play() {}, stop() {} });
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
  fontFamily: '"Digital Breakdown Grid V3", "Cascadia Code NF", "CaskaydiaCove Nerd Font", Consolas, monospace',
  fontSize: 17,
  lineHeight: 1.2,
  scrollback: 10000,
  theme: {
    background: "rgba(0, 25, 29, 0.88)",
    foreground: "#72e6c7",
    cursor: "#74ffbd",
    selectionBackground: "#28666d"
  }
});

const fit = new FitAddon();
terminal.loadAddon(fit);

terminal.open(document.getElementById("terminal"));
fit.fit();
terminal.focus();

const copyRaw = document.getElementById("copy-raw");
const copyFenced = document.getElementById("copy-fenced");
const paste = document.getElementById("paste");
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
    evidenceRepository.textContent = snapshot?.reason || "Read-only evidence is unavailable.";
    return;
  }
  const repository = snapshot.repository;
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
const socket = new WebSocket(`${protocol}//${location.host}/terminal`);

socket.addEventListener("open", () => {
  socket.send(JSON.stringify({
    type: "resize",
    cols: terminal.cols,
    rows: terminal.rows
  }));
  observeOptional("session.connected", { transport: "websocket" });
});

socket.addEventListener("message", event => {
  runFunctionalThenObserve(
    () => terminal.write(event.data),
    () => observeOptional("terminal.output", { length: String(event.data).length })
  );
});

socket.addEventListener("close", () => {
  terminal.writeln("\r\n[SESSION DISCONNECTED]");
  observeOptional("session.disconnected", { transport: "websocket" });
});

terminal.onData(data => {
  if (socket.readyState === WebSocket.OPEN) {
    runFunctionalThenObserve(
      () => socket.send(JSON.stringify({ type: "input", data })),
      () => observeOptional("terminal.input", { kind: classifyInput(data), length: data.length })
    );
  }
});

function resize() {
  fit.fit();
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({
      type: "resize",
      cols: terminal.cols,
      rows: terminal.rows
    }));
  }
  observeOptional("terminal.resize", { cols: terminal.cols, rows: terminal.rows });
}

new ResizeObserver(resize).observe(document.getElementById("terminal"));
window.addEventListener("resize", resize);
enableOptionalVisuals();
