// World-space rigs sit beyond the four cushion corners. A throw's seed chooses
// its rig once; neither the dice crossing the table nor frame rate changes it.
export const THROW_CAMERA_RIGS = Object.freeze([
  Object.freeze([8.6, 6.8, 6.2]),
  Object.freeze([-8.6, 6.8, 6.2]),
  Object.freeze([-8.6, 6.8, -6.2]),
  Object.freeze([8.6, 6.8, -6.2]),
]);
export const RESULT_CAMERA_HOLD_MS = 1600;
const radians = (degrees) => (degrees * Math.PI) / 180;
const degrees = (angle) => (angle * 180) / Math.PI;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export function throwCameraRig(throwState) {
  // Mix all seed bits, so adjacent authority seeds do not always pick the
  // neighboring corner. The fallback also makes replayed IDs deterministic.
  let hash = Number.isInteger(throwState.seed)
    ? throwState.seed >>> 0
    : 2166136261;
  if (!Number.isInteger(throwState.seed))
    for (const char of String(throwState.id))
      hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
  hash = Math.imul(hash ^ (hash >>> 16), 0x45d9f3b) >>> 0;
  return (hash ^ (hash >>> 16)) & 3;
}

/** Pure, clock-based camera direction, suitable for late joins and any FPS. */
export function sampleThrowCamera({
  throwState,
  pose,
  now,
  aspect = 1,
  reducedMotion = false,
}) {
  if (reducedMotion || !throwState || !pose?.dice?.length) return null;
  const { startAt, duration } = throwState;
  const settledAt = throwState.settledAt ?? startAt + duration;
  if (now < startAt || now >= settledAt + RESULT_CAMERA_HOLD_MS) return null;
  const target = [0, 0, 0];
  for (const die of pose.dice)
    for (let axis = 0; axis < 3; axis++)
      target[axis] += die.position[axis] / pose.dice.length;
  const radius =
    Math.max(
      ...pose.dice.map(({ position }) =>
        Math.hypot(...position.map((value, axis) => value - target[axis])),
      ),
    ) + 0.32;
  const narrowAxis = Math.min(1, Math.max(0.1, aspect));
  const rig = throwCameraRig(throwState);
  if (now >= settledAt) {
    const fov = 36;
    // At nearly square viewports the invite card reaches over the middle of
    // the top edge, so leave more headroom than the wide/portrait layouts.
    const framePadding = aspect >= 0.75 && aspect <= 1.25 ? 1.9 : 1.45;
    const height = Math.max(
      3,
      // Keep the full dice inside the central image, clear of the bottom
      // result banner and the brand/invite panels at the top corners.
      (radius * framePadding) / (Math.tan(radians(fov / 2)) * narrowAxis),
    );
    return {
      phase: "result",
      rig,
      target,
      fov,
      // A tiny Z offset makes the top-down look direction unambiguous with
      // OrbitControls' world-up vector, while retaining readable upper faces.
      position: [target[0], target[1] + height, target[2] + 0.004],
    };
  }
  const progress = clamp(
    (now - startAt) / Math.max(1, settledAt - startAt),
    0,
    1,
  );
  const position = [...THROW_CAMERA_RIGS[rig]];
  if (aspect < 1) for (let axis = 0; axis < 3; axis++) position[axis] *= 1.35;
  // Subtle physical movement stays within 6 cm of the selected fixed rig;
  // the slow lens zoom supplies motion without chasing the dice across felt.
  position[1] += Math.sin(progress * Math.PI) * 0.05;
  const distance = Math.hypot(
    ...position.map((value, axis) => value - target[axis]),
  );
  const fit = degrees(
    2 *
      Math.atan(
        Math.tan(Math.asin(Math.min(0.95, radius / distance))) / narrowAxis,
      ),
  );
  return {
    phase: "throw",
    rig,
    target,
    position,
    fov: Math.max(46 - progress * 6, fit * 1.1),
  };
}
