export const SUSPENSION_SEND_MS = 28;
export const SUSPENSION_BUFFER_MS = 42;
export const DROP_LEAD_MS = 55;

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
      Math.abs(x) > 2.5 ||
      y < 0 ||
      y > 2.65 ||
      Math.abs(z) > 1.85 ||
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
        Math.hypot(...velocity.slice(0, 3)) <= 14 &&
        Math.hypot(...velocity.slice(3)) <= 28,
    )
  )
    return null;
  return velocities;
}
