export const ORBIT_SEND_MS = 28;
export const ORBIT_TIMEOUT_MS = 450;
export const FLING_LEAD_MS = 90;
export const FLING_IMPACT_MS = 245;
export const FLING_REBOUND_MS = 445;
export const MAX_ORBIT_SPIN = 0.027;

const spinDecayMs = 365;

const clamp = (n, low, high) => Math.max(low, Math.min(high, n));

export function orbitInput(input) {
  if (
    !input ||
    ![input.x, input.y, input.turn, input.energy, input.spin ?? 0].every(
      Number.isFinite,
    )
  )
    return null;
  return {
    x: clamp(input.x, -1, 1),
    y: clamp(input.y, -1, 1),
    turn: clamp(input.turn, -1200, 1200),
    spin: clamp(input.spin ?? 0, -MAX_ORBIT_SPIN, MAX_ORBIT_SPIN),
    energy: clamp(input.energy, 0, 1),
  };
}

export const restOrbit = {
  x: 0,
  y: 0,
  turn: -Math.PI / 2,
  spin: 0,
  energy: 0,
};

export const orbitSpinAfter = (spin, ms) => spin * Math.exp(-ms / spinDecayMs);

// Integrate the same decaying velocity on the controller and when the TV
// extrapolates between packets. A stationary touch adds no angular motion.
export const orbitTurnAfter = (turn, spin, ms) =>
  turn - spin * spinDecayMs * Math.expm1(-ms / spinDecayMs);
