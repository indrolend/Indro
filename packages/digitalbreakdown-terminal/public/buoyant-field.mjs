export class BuoyantField {
  constructor(size = 96, { damping = 0.965, tension = 0.16 } = {}) {
    if (!Number.isInteger(size) || size < 8) throw new RangeError("size must be an integer of at least 8");
    this.size = size;
    this.damping = damping;
    this.tension = tension;
    this.height = new Float32Array(size);
    this.velocity = new Float32Array(size);
  }

  disturb(position, energy) {
    const center = Math.max(1, Math.min(this.size - 2, Math.round(position * (this.size - 1))));
    const bounded = Math.max(-2, Math.min(2, Number(energy) || 0));
    this.velocity[center] += bounded;
    this.velocity[center - 1] += bounded * 0.45;
    this.velocity[center + 1] += bounded * 0.45;
  }

  step(dt = 1 / 60) {
    const scale = Math.max(0, Math.min(3, dt * 60));
    const nextVelocity = new Float32Array(this.velocity);
    for (let index = 1; index < this.size - 1; index += 1) {
      const curvature = this.height[index - 1] + this.height[index + 1] - 2 * this.height[index];
      nextVelocity[index] = (this.velocity[index] + curvature * this.tension * scale) * this.damping;
    }
    nextVelocity[0] = -nextVelocity[1] * 0.35;
    nextVelocity[this.size - 1] = -nextVelocity[this.size - 2] * 0.35;
    for (let index = 0; index < this.size; index += 1) {
      this.velocity[index] = nextVelocity[index];
      this.height[index] += this.velocity[index] * scale;
    }
  }
}

export function energyForObservation(event) {
  if (event.historicalReplay) return 0;
  if (event.eventType === "terminal.input") {
    if (event.observedState.kind === "backspace") return -0.9;
    if (event.observedState.kind === "interrupt") return -1.3;
    return Math.min(1.4, 0.25 + (event.observedState.length ?? 1) * 0.12);
  }
  if (event.eventType === "terminal.output") {
    return Math.min(0.55, (event.observedState.length ?? 0) / 600);
  }
  return 0;
}
