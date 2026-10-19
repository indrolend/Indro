// A presentation-only grammar for an explicit compact -> expanded transition.
// It does not interpret terminal cells or alter any authoritative record.
const PARTICLES = ["⠂", "⠒", "⠤", "⠲", "⠴", "⠦", "⠖", "⠶"];

function fit(value, width) {
  const text = String(value);
  return text.length > width ? `${text.slice(0, Math.max(1, width - 1))}…` : text.padEnd(width);
}

// Adapted from CommandHUD's tested shell visual grammar. Keeping this pure makes
// its endpoint-preservation contract independently testable in the terminal.
export function particleMorphFrames(from, to) {
  const width = Math.max(String(from).length, String(to).length);
  const before = fit(from, width);
  const after = fit(to, width);
  const scatter = phase => Array.from({ length: width }, (_, index) => PARTICLES[(index * 3 + phase) % PARTICLES.length]).join("");
  return [
    before,
    Array.from(before, (character, index) => index % 2 ? PARTICLES[(index + 1) % PARTICLES.length] : character).join(""),
    scatter(2),
    Array.from(after, (character, index) => index % 2 ? character : PARTICLES[(index + 4) % PARTICLES.length]).join(""),
    after
  ];
}

export function motionAllowed(windowObject = window) {
  return !windowObject.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function createSemanticMorph(layer, { windowObject = window } = {}) {
  let timer = null;
  const stop = () => {
    if (timer) windowObject.clearTimeout(timer);
    timer = null;
    layer.replaceChildren();
  };

  return Object.freeze({
    stop,
    play({ from, to, source, target }) {
      stop();
      if (!motionAllowed(windowObject) || !source || !target) return;
      const sourceBox = source.getBoundingClientRect();
      const targetBox = target.getBoundingClientRect();
      const stage = document.createElement("div");
      stage.className = "semantic-morph-stage";
      stage.style.setProperty("--from-x", `${sourceBox.left}px`);
      stage.style.setProperty("--from-y", `${sourceBox.top}px`);
      stage.style.setProperty("--to-x", `${targetBox.left}px`);
      stage.style.setProperty("--to-y", `${targetBox.top}px`);
      stage.style.setProperty("--to-width", `${Math.max(96, targetBox.width)}px`);
      const glyph = document.createElement("span");
      glyph.className = "semantic-morph-glyph";
      stage.append(glyph);
      layer.append(stage);
      const frames = particleMorphFrames(from, to);
      let index = 0;
      const draw = () => {
        glyph.textContent = frames[index];
        glyph.dataset.phase = String(index);
        index++;
        if (index < frames.length) timer = windowObject.setTimeout(draw, 65);
        else timer = windowObject.setTimeout(stop, 180);
      };
      draw();
    }
  });
}
