// Table-level rigs are inside the cushion corners. A recorded trajectory
// chooses one rig for the entire throw; the camera never chases the dice.
export const THROW_CAMERA_RIGS = Object.freeze([
  Object.freeze([5.0, 0.38, 2.3]),
  Object.freeze([-5.0, 0.38, 2.3]),
  Object.freeze([-5.0, 0.38, -2.3]),
  Object.freeze([5.0, 0.38, -2.3]),
]);
export const RESULT_CAMERA_HOLD_MS = 1600;
export const BETWEEN_ROUND_BREATHER_MS = 1000;
const radians = (degrees) => (degrees * Math.PI) / 180;
const degrees = (angle) => (angle * 180) / Math.PI;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

// Includes the complete outer deck, dealer inventory, and the tallest visible
// player bank, rather than framing only the recessed felt.
export const BETTING_TABLE_BOUNDS = Object.freeze({
  min: Object.freeze([-7.35, 0, -3.65]),
  max: Object.freeze([7.35, 1.9, 4.65]),
});

export function fitBettingCamera({
  aspect = 16 / 9,
  top = 0.13,
  bottom = 0.88,
  horizontalLimit = 0.92,
} = {}) {
  const fov = 43,
    tangent = Math.tan(radians(fov / 2));
  const pitch = 0.15,
    cosine = Math.cos(pitch),
    sine = Math.sin(pitch),
    targetY = 0.4;
  const upper = 1 - 2 * Math.min(0.45, top + 0.01);
  const lower = 1 - 2 * Math.max(0.55, bottom - 0.01);
  const coefficients = (edge) => ({
    a: (edge * tangent) / (cosine * (cosine - edge * tangent * sine)),
    b: (edge * tangent * cosine + sine) / (cosine - edge * tangent * sine),
  });
  const lo = coefficients(lower),
    hi = coefficients(upper);
  const corners = [];
  for (const x of [BETTING_TABLE_BOUNDS.min[0], BETTING_TABLE_BOUNDS.max[0]])
    for (const y of [BETTING_TABLE_BOUNDS.min[1], BETTING_TABLE_BOUNDS.max[1]])
      for (const z of [
        BETTING_TABLE_BOUNDS.min[2],
        BETTING_TABLE_BOUNDS.max[2],
      ])
        corners.push([x, y, z]);
  const lowerOffset = Math.max(
    ...corners.map(([, y, z]) => z - (y - targetY) * lo.b),
  );
  const upperOffset = Math.min(
    ...corners.map(([, y, z]) => z - (y - targetY) * hi.b),
  );
  const centerA = (lo.a + hi.a) / 2,
    centerOffset = (lowerOffset + upperOffset) / 2;
  const verticalHeight = (lowerOffset - upperOffset) / (hi.a - lo.a);
  const horizontalHeight = Math.max(
    ...corners.map(
      ([x, y, z]) =>
        (Math.abs(x) /
          (tangent * Math.max(0.2, aspect) * Math.max(0.3, horizontalLimit)) +
          (y - targetY) * cosine +
          z * sine -
          centerOffset * sine) /
        (1 / cosine + centerA * sine),
    ),
  );
  const height = Math.max(10.8, verticalHeight, horizontalHeight) * 1.01;
  const targetZ = centerA * height + centerOffset;
  return {
    phase: "betting",
    position: [0, targetY + height, targetZ + height * Math.tan(pitch)],
    target: [0, targetY, targetZ],
    fov,
  };
}

/** Auto's resting views: wide lobby, brief optional breather, then betting bed. */
export function sampleTableCamera({
  state,
  now,
  aspect = 16 / 9,
  viewportWidth = 0,
  viewportHeight = 0,
  hudRects = [],
  reducedMotion = false,
}) {
  if (state?.status !== "playing")
    return {
      phase: "lobby",
      position: [8.4, 7.4, 17.6],
      target: [0, 0.4, 0.4],
      fov: 48,
    };
  const resultEnd = state.throw
    ? (state.throw.settledAt ?? state.throw.startAt + state.throw.duration) +
      RESULT_CAMERA_HOLD_MS
    : null;
  if (
    !reducedMotion &&
    !state.rolling &&
    resultEnd !== null &&
    now >= resultEnd &&
    now < resultEnd + BETWEEN_ROUND_BREATHER_MS &&
    state.nextRollAt >= resultEnd + BETWEEN_ROUND_BREATHER_MS + 3000
  )
    return {
      phase: "breather",
      position: [8.4, 7.4, 15.4],
      target: [0, 0.4, 0.4],
      fov: 48,
    };
  // The active table view intentionally prioritizes the betting bed. The
  // outer trays can leave the frame; chip-aware labels stay clear of the bed.
  const height = Math.max(8.6, 5.6 / Math.max(0.45, aspect));
  return {
    phase: "betting",
    position: [0, height + 0.2, 1.25],
    target: [0, 0.2, 0],
    fov: 43,
  };
}

const rigCache = new Map();
export function throwCameraRig(throwState) {
  const key = `${throwState.id}:${throwState.seed}`;
  if (rigCache.has(key)) return rigCache.get(key);
  let hash = Number.isInteger(throwState.seed)
    ? throwState.seed >>> 0
    : 2166136261;
  if (!Number.isInteger(throwState.seed))
    for (const char of String(throwState.id))
      hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
  hash = Math.imul(hash ^ (hash >>> 16), 0x45d9f3b) >>> 0;
  let selected = (hash ^ (hash >>> 16)) & 3;
  if (throwState.frames?.length) {
    let best = Infinity;
    for (let rig = 0; rig < THROW_CAMERA_RIGS.length; rig++) {
      const eye = THROW_CAMERA_RIGS[rig];
      let nearest = Infinity,
        largestAngle = 0,
        totalDistance = 0,
        count = 0;
      for (
        let i = 0;
        i < throwState.frames.length;
        i += Math.max(1, Math.floor(throwState.frames.length / 60))
      ) {
        const frame = throwState.frames[i];
        const a = [frame[1] - eye[0], frame[2] - eye[1], frame[3] - eye[2]],
          b = [frame[8] - eye[0], frame[9] - eye[1], frame[10] - eye[2]];
        const da = Math.hypot(...a),
          db = Math.hypot(...b);
        nearest = Math.min(nearest, da, db);
        totalDistance += da + db;
        count += 2;
        largestAngle = Math.max(
          largestAngle,
          Math.acos(
            clamp(
              a.reduce((sum, v, j) => sum + v * b[j], 0) / (da * db),
              -1,
              1,
            ),
          ),
        );
      }
      const score =
        largestAngle * 2 +
        Math.max(0, 1.2 - nearest) * 5 +
        (totalDistance / count) * 0.015;
      if (score < best) {
        best = score;
        selected = rig;
      }
    }
  }
  rigCache.set(key, selected);
  if (rigCache.size > 64) rigCache.delete(rigCache.keys().next().value);
  return selected;
}

/** Pure, clock-based camera direction, suitable for late joins and any FPS. */
export function sampleThrowCamera({
  throwState,
  pose,
  now,
  aspect = 1,
  reducedMotion = false,
  viewportWidth = 0,
  viewportHeight = 0,
  hudRects = [],
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
    let framePadding = aspect >= 0.75 && aspect <= 1.25 ? 1.9 : 1.45;
    if (viewportWidth > 0 && viewportHeight > 0 && hudRects.length) {
      // Use the actual TV layout, including its distance-readable larger HUD.
      // Reserve a central horizontal band so neither resting die sits behind
      // the invite, logo, or result banner at any display density.
      let top = 0,
        bottom = viewportHeight;
      for (const rect of hudRects) {
        if (rect.y + rect.height <= viewportHeight * 0.5)
          top = Math.max(top, rect.y + rect.height);
        else if (rect.y >= viewportHeight * 0.5)
          bottom = Math.min(bottom, rect.y);
      }
      const safeHalf = Math.max(
        0.2,
        Math.min(
          1 - (2 * top) / viewportHeight,
          (2 * bottom) / viewportHeight - 1,
        ),
      );
      framePadding = Math.max(framePadding, 1.05 / safeHalf);
    }
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
  position[1] += Math.sin(progress * Math.PI) * 0.01;
  const direction = target.map((value, axis) => value - position[axis]);
  const length = Math.hypot(...direction);
  direction.forEach((value, axis) => {
    direction[axis] = value / length;
  });
  const horizontal = Math.hypot(direction[0], direction[2]) || 1;
  const right = [-direction[2] / horizontal, 0, direction[0] / horizontal];
  const up = [
    right[1] * direction[2] - right[2] * direction[1],
    right[2] * direction[0] - right[0] * direction[2],
    right[0] * direction[1] - right[1] * direction[0],
  ];
  let halfTangent = 0;
  for (const die of pose.dice) {
    const vector = die.position.map((value, axis) => value - position[axis]);
    const depth = Math.max(
      0.08,
      vector.reduce((sum, value, axis) => sum + value * direction[axis], 0) -
        0.2,
    );
    const x =
      Math.abs(
        vector.reduce((sum, value, axis) => sum + value * right[axis], 0),
      ) + 0.2;
    const y =
      Math.abs(vector.reduce((sum, value, axis) => sum + value * up[axis], 0)) +
      0.2;
    halfTangent = Math.max(
      halfTangent,
      x / (depth * Math.max(0.2, aspect)),
      y / depth,
    );
  }
  return {
    phase: "throw",
    rig,
    target,
    position,
    fov: Math.max(
      54 - progress * 6,
      degrees(2 * Math.atan(halfTangent * 1.08)),
    ),
  };
}
