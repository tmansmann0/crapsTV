export const SUSPENSION_SEND_MS = 28;
export const SUSPENSION_BUFFER_MS = 42;
export const FLING_LEAD_MS = 90;
export const FLING_IMPACT_MS = 245;
export const FLING_REBOUND_MS = 445;

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
