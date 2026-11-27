export const SUSPENSION_SEND_MS = 28;
export const SUSPENSION_BUFFER_MS = 42;
export const DROP_LEAD_MS = 55;
export const CHANCE_DICE_BOUNDS = {
  side: 2.68,
  back: -1.66,
  front: 1.85,
  ceiling: 2.32,
};
export const CHANCE_PHONE_HALF_WIDTH = CHANCE_DICE_BOUNDS.side + 0.06;
export const SUSPENSION_MAX_SPEED = 14;
export const SUSPENSION_MAX_SPIN = 44;

export function suspensionPoses(poses) {
  if (!Array.isArray(poses) || poses.length !== 2) return null;
  for (const pose of poses) {
    if (
      !Array.isArray(pose) ||
      pose.length !== 7 ||
      !pose.every(Number.isFinite)
    )
      return null;
    const [x, y, z, qx, qy, qz, qw] = pose;
    const length = Math.hypot(qx, qy, qz, qw);
    if (
      Math.abs(x) > CHANCE_DICE_BOUNDS.side + 0.17 ||
      y < 0 ||
      y > CHANCE_DICE_BOUNDS.ceiling + 0.33 ||
      z < CHANCE_DICE_BOUNDS.back - 0.24 ||
      z > CHANCE_DICE_BOUNDS.front + 0.24 ||
      length < 0.98 ||
      length > 1.02
    )
      return null;
  }
  return poses;
}

export function suspensionVelocities(velocities) {
  if (!Array.isArray(velocities) || velocities.length !== 2) return null;
  if (
    !velocities.every(
      (velocity) =>
        Array.isArray(velocity) &&
        velocity.length === 6 &&
        velocity.every((n) => Number.isFinite(n)) &&
        Math.hypot(...velocity.slice(0, 3)) <= SUSPENSION_MAX_SPEED &&
        Math.hypot(...velocity.slice(3)) <= SUSPENSION_MAX_SPIN,
    )
  )
    return null;
  return velocities;
}
