import { createJellyState, DURATION } from "./jelly-physics.mjs";

const ANSI_16 = [
  "#00191d", "#ff657a", "#74ffbd", "#f1c86a", "#58aeb0", "#df70df", "#72e6c7", "#d9fff4",
  "#38666b", "#ff8b9b", "#a0ffd1", "#ffe19a", "#82cfd1", "#f09cf0", "#a2f9e2", "#ffffff"
];

function hexRgb(value) {
  return `#${value.toString(16).padStart(6, "0")}`;
}

export function paletteColor(index) {
  if (index < 16) return ANSI_16[index] ?? ANSI_16[6];
  if (index < 232) {
    const offset = index - 16;
    const levels = [0, 95, 135, 175, 215, 255];
    return `rgb(${levels[Math.floor(offset / 36)]}, ${levels[Math.floor(offset / 6) % 6]}, ${levels[offset % 6]})`;
  }
  const gray = 8 + (index - 232) * 10;
  return `rgb(${gray}, ${gray}, ${gray})`;
}

export function foregroundForCell(cell, defaultColor = ANSI_16[6]) {
  if (cell.isInvisible?.()) return "transparent";
  if (cell.isFgRGB?.()) return hexRgb(cell.getFgColor());
  if (cell.isFgPalette?.()) return paletteColor(cell.getFgColor());
  return defaultColor;
}

export function projectVisibleCells(buffer, rows, cols, defaultColor) {
  const projected = [];
  const cell = buffer.getNullCell();
  for (let row = 0; row < rows; row += 1) {
    const line = buffer.getLine(buffer.viewportY + row);
    if (!line) continue;
    for (let col = 0; col < cols; col += 1) {
      const loaded = line.getCell(col, cell);
      if (!loaded) continue;
      const width = loaded.getWidth();
      const chars = loaded.getChars();
      if (width === 0 || !chars) continue;
      const foreground = foregroundForCell(loaded, defaultColor);
      const styles = {
        bold: Boolean(loaded.isBold?.()), italic: Boolean(loaded.isItalic?.()),
        underline: Boolean(loaded.isUnderline?.()), strike: Boolean(loaded.isStrikethrough?.())
      };
      projected.push(Object.freeze({
        row, col, chars, width, foreground, styles,
        identity: `${chars}\u0000${width}\u0000${foreground}\u0000${Number(styles.bold)}${Number(styles.italic)}${Number(styles.underline)}${Number(styles.strike)}`
      }));
    }
  }
  return projected;
}

export function createJellyOverlay({ host, terminal, now = () => performance.now() / 1000 }) {
  const layer = document.createElement("div");
  layer.id = "jelly-overlay";
  layer.setAttribute("aria-hidden", "true");
  host.append(layer);
  const state = createJellyState();
  const elements = new Map();
  let enabled = false;
  let dirty = true;
  let frame = 0;
  let activeUntil = 0;

  const disposables = [
    terminal.onRender(() => { dirty = true; activeUntil = now() + DURATION; schedule(); }),
    terminal.onScroll(() => { dirty = true; activeUntil = now() + DURATION; schedule(); }),
    terminal.onResize(() => { dirty = true; activeUntil = now() + DURATION; schedule(); })
  ];

  function updateTransforms(time) {
    for (const [key, element] of elements) {
      const [row, col] = key.split(":").map(Number);
      const transform = state.update(row, col, element.dataset.identity, time);
      element.style.setProperty("--sx", transform.sx);
      element.style.setProperty("--sy", transform.sy);
      element.style.setProperty("--dy", `${transform.dy}px`);
    }
  }

  function syncProjection(time) {
    const cells = projectVisibleCells(terminal.buffer.active, terminal.rows, terminal.cols, terminal.options.theme?.foreground);
    const present = new Set();
    const fragment = document.createDocumentFragment();
    for (const glyph of cells) {
      const key = `${glyph.row}:${glyph.col}`;
      present.add(key);
      let element = elements.get(key);
      if (!element) {
        element = document.createElement("span");
        element.className = "jelly-glyph";
        elements.set(key, element);
      }
      element.textContent = glyph.chars;
      element.style.setProperty("--row", glyph.row);
      element.style.setProperty("--col", glyph.col);
      element.style.setProperty("--cells", glyph.width);
      element.style.color = glyph.foreground;
      element.style.fontWeight = glyph.styles.bold ? "bold" : "normal";
      element.style.fontStyle = glyph.styles.italic ? "italic" : "normal";
      element.style.textDecoration = `${glyph.styles.underline ? "underline" : ""} ${glyph.styles.strike ? "line-through" : ""}`.trim();
      element.dataset.identity = glyph.identity;
      fragment.append(element);
    }
    for (const [key, element] of elements) {
      if (!present.has(key)) {
        element.remove();
        elements.delete(key);
      }
    }
    state.forgetMissing(present);
    layer.replaceChildren(fragment);
    dirty = false;
    updateTransforms(time);
  }

  function draw() {
    frame = 0;
    if (!enabled) return;
    const time = now();
    if (dirty) syncProjection(time);
    else updateTransforms(time);
    if (time < activeUntil) schedule();
  }

  function schedule() {
    if (enabled && !frame) frame = requestAnimationFrame(draw);
  }

  function setEnabled(value) {
    enabled = Boolean(value);
    host.dataset.jelly = enabled ? "on" : "off";
    layer.hidden = !enabled;
    if (!enabled) {
      cancelAnimationFrame(frame);
      frame = 0;
      layer.replaceChildren();
      elements.clear();
      state.clear();
      return;
    }
    dirty = true;
    activeUntil = now() + DURATION;
    schedule();
  }

  return Object.freeze({
    get enabled() { return enabled; }, setEnabled,
    dispose() {
      setEnabled(false);
      for (const disposable of disposables) disposable.dispose();
      layer.remove();
    }
  });
}
