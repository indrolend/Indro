const EVENT_TYPES = new Set([
  "session.connected",
  "session.disconnected",
  "terminal.input",
  "terminal.output",
  "terminal.resize",
  "clipboard.selection",
  "clipboard.copy",
  "clipboard.paste",
  "commandhud.operation",
  "commandhud.evidence.expanded"
]);

export function createObservationStream({
  sessionIdentity,
  clock = () => new Date().toISOString(),
  onEvent = () => {}
}) {
  if (typeof sessionIdentity !== "string" || !sessionIdentity) {
    throw new TypeError("sessionIdentity must be a non-empty string");
  }

  let sequence = 0;

  return Object.freeze({
    observe(eventType, observedState = {}, options = {}) {
      if (!EVENT_TYPES.has(eventType)) {
        throw new TypeError(`Unsupported observation event: ${eventType}`);
      }
      if (!observedState || typeof observedState !== "object" || Array.isArray(observedState)) {
        throw new TypeError("observedState must be an object");
      }

      sequence += 1;
      const event = Object.freeze({
        eventIdentity: `${sessionIdentity}:${sequence}`,
        sourceSystem: "digitalbreakdown-terminal",
        sourceRecordIdentity: options.sourceRecordIdentity ?? null,
        timestamp: clock(),
        sessionIdentity,
        operationIdentity: options.operationIdentity ?? null,
        eventType,
        observedState: Object.freeze({ ...observedState }),
        evidenceReference: options.evidenceReference ?? null,
        verificationStatus: options.verificationStatus ?? "unverified",
        relatedObjects: Object.freeze([...(options.relatedObjects ?? [])]),
        historicalReplay: options.historicalReplay === true
      });
      onEvent(event);
      return event;
    }
  });
}

export function classifyInput(data) {
  if (typeof data !== "string") throw new TypeError("input data must be a string");
  if (data === "\x7f" || data === "\b") return "backspace";
  if (data === "\t") return "completion-request";
  if (data === "\x03") return "interrupt";
  if (data === "\r" || data === "\n") return "submit-key";
  if (data.startsWith("\x1b")) return "control-sequence";
  return "text";
}
