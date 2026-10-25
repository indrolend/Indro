export function quotePowerShellPath(path) {
  if (typeof path !== "string" || !path.length) throw new TypeError("Path required");
  if (/[\r\n\0]/.test(path)) throw new TypeError("Invalid path");
  return "'" + path.replace(/'/g, "''") + "'";
}
export function droppedText(transfer) {
  if (!transfer) return "";
  const files = Array.from(transfer.files ?? []);
  if (files.length) {
    const paths = files.map(file => file.path).filter(Boolean);
    return paths.length === files.length ? paths.map(quotePowerShellPath).join(" ") : "";
  }
  return transfer.getData("text/plain") || "";
}

export function createCursorInteraction({ host, terminal, status, observe = () => {} }) {
  const cursor = document.createElement("div");
  cursor.id = "clipboard-cursor";
  cursor.setAttribute("aria-hidden", "true");
  cursor.textContent = "CLIP";
  cursor.hidden = true;
  document.body.append(cursor);
  let kind = "empty";
  let dragDepth = 0;
  let dragging = false;
  let x = 0, y = 0, vx = 0, vy = 0;
  let tx = 0, ty = 0;
  let frame = 0;
  let active = false;
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  function render() {
    if (!active) return;
    if (reduced.matches) { x = tx; y = ty; }
    else {
      vx = (vx + (tx - x) * 0.12) * 0.72;
      vy = (vy + (ty - y) * 0.12) * 0.72;
      x += vx; y += vy;
    }
    cursor.style.transform = `translate3d(${x + 16}px,${y + 16}px,0)`;
    frame = requestAnimationFrame(render);
  }
  function show(label) {
    kind = label;
    cursor.textContent = label;
    cursor.dataset.state = label.toLowerCase();
    cursor.hidden = false;
    if (!active) { active = true; frame = requestAnimationFrame(render); }
  }
  function hide() {
    if (dragging) return;
    active = false;
    cancelAnimationFrame(frame);
    cursor.hidden = true;
  }
  function pointer(event) { tx = event.clientX; ty = event.clientY; }
  function clipboard(event) {
    const types = Array.from(event.clipboardData?.types ?? []);
    if (types.includes("Files")) show("FILES");
    else if (types.includes("text/plain")) show("TEXT");
  }
  document.addEventListener("pointermove", pointer, { passive: true });
  host.addEventListener("pointerenter", () => { if (kind !== "empty") show(kind); });
  host.addEventListener("pointerleave", hide);
  document.addEventListener("copy", event => {
    clipboard(event);
    if (kind === "empty") show("TEXT");
  });
  document.addEventListener("paste", clipboard);
  host.addEventListener("dragenter", event => {
    if (!event.dataTransfer?.types.includes("Files") &&
        !event.dataTransfer?.types.includes("text/plain")) return;
    event.preventDefault();
    dragDepth += 1;
    dragging = true;
    host.dataset.dropTarget = "active";
    show(event.dataTransfer.types.includes("Files") ? "FILES" : "TEXT");
    pointer(event);
  });
  host.addEventListener("dragover", event => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    pointer(event);
  });
  host.addEventListener("dragleave", event => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth > 0 || host.contains(event.relatedTarget)) return;
    dragging = false;
    delete host.dataset.dropTarget;
    hide();
  });
  host.addEventListener("drop", event => {
    event.preventDefault();
    dragging = false;
    dragDepth = 0;
    delete host.dataset.dropTarget;
    const files = Array.from(event.dataTransfer?.files ?? []);
    if (files.length && files.some(file => !file.path)) {
      status("FILE PATH UNAVAILABLE — USE COPY PATH");
      show("FILES");
      return;
    }
    const text = droppedText(event.dataTransfer);
    if (!text) return;
    terminal.paste(text);
    terminal.focus();
    status(`${text.length} CH INSERTED`);
    observe("clipboard.paste", { mode: "drop", length: text.length });
    show(files.length ? "FILES" : "TEXT");
  });
  return {
    copied(type = "TEXT") { show(type); },
    dispose() {
      active = false;
      cancelAnimationFrame(frame);
      cursor.remove();
    }
  };
}
