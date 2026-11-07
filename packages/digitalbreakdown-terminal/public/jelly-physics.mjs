export const DURATION = 0.72;
export const MAX_DISPLACEMENT = 6;

export function jellyTransform(age) {
  if (!Number.isFinite(age) || age < 0 || age >= DURATION)
    return { sx: 1, sy: 1, dy: 0 };

  const envelope = Math.exp(-5.5 * age);
  const wave = Math.cos(22 * age);

  return {
    sx: Math.max(0.72, Math.min(1.28, 1 + envelope * wave * 0.25)),
    sy: Math.max(0.72, Math.min(1.28, 1 - envelope * wave * 0.20)),
    // Keep the response below its authoritative xterm cell. The absolute
    // spring wave gives a visible rebound without crossing the baseline.
    dy: Math.min(MAX_DISPLACEMENT, envelope * (2.5 + Math.abs(Math.sin(22 * age)) * 3.5))
  };
}

export function createJellyState() {
  const previous = new Map();
  const born = new Map();

  return {
    update(row, col, identity, now) {
      const key = `${row}:${col}`;
      if (previous.get(key) !== identity) {
        previous.set(key, identity);
        born.set(key, now);
      }
      return jellyTransform(now - born.get(key));
    },
    forgetMissing(keys) {
      for (const key of previous.keys()) {
        if (!keys.has(key)) {
          previous.delete(key);
          born.delete(key);
        }
      }
    },
    clear() {
      previous.clear();
      born.clear();
    }
  };
}
