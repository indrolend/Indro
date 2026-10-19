import { BuoyantField, energyForObservation } from "./buoyant-field.mjs";

export function createBuoyantCanvas(canvas) {
  const context = canvas.getContext("2d", { alpha: true });
  const field = new BuoyantField(112);
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
  let inputPosition = 0.08;
  let frame = 0;
  let previous = performance.now();

  function resize() {
    const ratio = Math.min(devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.round(canvas.clientWidth * ratio));
    const height = Math.max(1, Math.round(canvas.clientHeight * ratio));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
  }

  function draw(now) {
    resize();
    const dt = Math.min(0.05, Math.max(0, (now - previous) / 1000));
    previous = now;
    if (!reducedMotion.matches) field.step(dt);
    context.clearRect(0, 0, canvas.width, canvas.height);
    const baseline = canvas.height * 0.72;
    context.beginPath();
    context.moveTo(0, canvas.height);
    for (let index = 0; index < field.size; index += 1) {
      const x = index / (field.size - 1) * canvas.width;
      const y = baseline - field.height[index] * Math.min(34, canvas.height * 0.07);
      context.lineTo(x, y);
    }
    context.lineTo(canvas.width, canvas.height);
    context.closePath();
    const gradient = context.createLinearGradient(0, baseline - 40, 0, canvas.height);
    gradient.addColorStop(0, "rgba(70, 235, 202, 0.11)");
    gradient.addColorStop(1, "rgba(9, 76, 89, 0.30)");
    context.fillStyle = gradient;
    context.fill();
    context.strokeStyle = "rgba(114, 230, 199, 0.32)";
    context.lineWidth = Math.max(1, canvas.width / 900);
    context.stroke();
    frame = requestAnimationFrame(draw);
  }

  frame = requestAnimationFrame(draw);
  return Object.freeze({
    observe(event) {
      if (reducedMotion.matches) return;
      const energy = energyForObservation(event);
      if (!energy) return;
      if (event.eventType === "terminal.input") {
        inputPosition = Math.min(0.94, inputPosition + 0.013 * (event.observedState.length ?? 1));
      }
      field.disturb(inputPosition, energy);
    },
    dispose() { cancelAnimationFrame(frame); }
  });
}
