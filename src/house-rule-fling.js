export const ORBIT_SEND_MS = 28;
export const ORBIT_TIMEOUT_MS = 450;
export const FLING_LEAD_MS = 90;
export const FLING_IMPACT_MS = 245;
export const FLING_REBOUND_MS = 445;

const clamp = (n, low, high) => Math.max(low, Math.min(high, n));

export function orbitInput(input) {
  if (
    !input ||
    ![input.x, input.y, input.turn, input.energy].every(Number.isFinite)
  )
    return null;
  return {
    x: clamp(input.x, -1, 1),
    y: clamp(input.y, -1, 1),
    turn: clamp(input.turn, -1200, 1200),
    energy: clamp(input.energy, 0, 1),
  };
}

export const restOrbit = { x: 0, y: 0, turn: 0, energy: 0.34 };
export const orbitSpeed = (energy) => 0.0046 + 0.0076 * energy;
