export function createClipboardProjection(text, mode = "raw") {
  if (typeof text !== "string") throw new TypeError("clipboard text must be a string");
  if (mode === "raw") return text;
  if (mode !== "fenced") throw new TypeError(`Unsupported clipboard mode: ${mode}`);

  const longestRun = Math.max(0, ...[...text.matchAll(/`+/g)].map(match => match[0].length));
  const fence = "`".repeat(Math.max(3, longestRun + 1));
  return `${fence}text\n${text}\n${fence}`;
}

export function clipboardObservedState(mode, text) {
  if (typeof text !== "string") throw new TypeError("clipboard text must be a string");
  return Object.freeze({ mode, length: text.length });
}
