// High-frequency aim packets stay outside the React room snapshot.
export function createAimChannel() {
  let current = null;
  const listeners = new Set();
  return {
    get: () => current,
    set(next) {
      if (
        current === next ||
        (current &&
          next &&
          current.at === next.at &&
          current.playerId === next.playerId &&
          current.x === next.x &&
          current.power === next.power &&
          current.active === next.active)
      )
        return;
      current = next;
      for (const listener of listeners) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export const AIM_INTERVAL_MS = 110;

export function smoothAim(previous, target, elapsed, reducedMotion) {
  if (!target?.active) return null;
  if (!previous || reducedMotion || previous.playerId !== target.playerId)
    return target;
  // After an expensive or backgrounded frame, the latest packet may have
  // arrived just before the draw. Avoid jumping the full gap in one update.
  const weight = 1 - Math.exp(-Math.min(elapsed, 60) / 38);
  const approach = (value, goal) =>
    Math.abs(goal - value) < 0.001 ? goal : value + (goal - value) * weight;
  const x = approach(previous.x, target.x);
  const power = approach(previous.power, target.power);
  return x === previous.x && power === previous.power
    ? previous
    : { playerId: target.playerId, x, power };
}
