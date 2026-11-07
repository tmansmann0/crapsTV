// Shared, deterministic chip detail and pile geometry. No DOM or THREE imports.
export const CHIP_MAX_TILT = 0.01;
export const CHIP_OFFSET_RATIO = 0.027;
export const chipHash = (value) =>
  [...String(value)].reduce(
    (n, c) => Math.imul(n ^ c.charCodeAt(0), 16777619) >>> 0,
    2166136261,
  );
const unit = (seed) => chipHash(seed) / 4294967295;

/** Packed dirt/finish variation; stable when a chip moves or switches LOD. */
export function chipPatinaParameters(spec, index = 0) {
  const seed =
    spec.id ?? `${spec.denomination || 500}:${spec.wear || 0}:${index}`;
  return [
    unit(`${seed}:u`),
    unit(`${seed}:v`),
    0.25 + unit(`${seed}:use`) * 0.75,
  ];
}

function orientation(seed, index) {
  const key = `${seed}:${index}`;
  return [
    ((unit(`${key}:tilt-x`) * 2 - 1) * CHIP_MAX_TILT) / Math.SQRT2,
    unit(`${key}:yaw`) * Math.PI * 2,
    ((unit(`${key}:tilt-z`) * 2 - 1) * CHIP_MAX_TILT) / Math.SQRT2,
  ];
}
function axisFor([x = 0, y = 0, z = 0]) {
  return [
    -Math.cos(y) * Math.sin(z),
    Math.cos(x) * Math.cos(z) - Math.sin(x) * Math.sin(y) * Math.sin(z),
    Math.sin(x) * Math.cos(z) + Math.cos(x) * Math.sin(y) * Math.sin(z),
  ];
}
function halfExtents(diameter, thicknessScale, rotation) {
  const axis = axisFor(rotation),
    radius = diameter / 2,
    halfHeight = (0.13 * diameter * thicknessScale) / 2;
  return axis.map(
    (a) =>
      radius * Math.sqrt(Math.max(0, 1 - a * a)) + halfHeight * Math.abs(a),
  );
}

/** Adding or removing chips never rearranges the chips already below them. */
export function chipStackPose(
  seed,
  index,
  { diameter = 0.31, thicknessScale = 1.3, gap = 0.0008 } = {},
) {
  const n = Math.max(0, Math.floor(index));
  const rotation = orientation(seed, n);
  let floor = 0;
  for (let i = 0; i < n; i++)
    floor +=
      2 * halfExtents(diameter, thicknessScale, orientation(seed, i))[1] + gap;
  const phase = unit(`${seed}:lean`) * Math.PI * 2;
  const a = unit(`${seed}:${n}:offset`) * Math.PI * 2;
  const r =
    diameter *
    CHIP_OFFSET_RATIO *
    (0.35 + unit(`${seed}:${n}:offset-radius`) * 0.65);
  // A slow phase drift gives a hand-placed stack, without accumulating lean.
  const angle = a * 0.65 + phase + n * 0.43;
  return {
    position: [
      Math.cos(angle) * r,
      floor + halfExtents(diameter, thicknessScale, rotation)[1],
      Math.sin(angle) * r,
    ],
    rotation,
  };
}

/** Tight tilted-cylinder AABB and conservative radial collider envelope. */
export function chipPoseBounds(spec) {
  const diameter = spec.diameter ?? 0.31,
    thicknessScale = spec.thicknessScale ?? 1.3;
  const rotation = spec.rotation || [0, 0, 0],
    position = spec.position || [0, 0, 0];
  const extents = halfExtents(diameter, thicknessScale, rotation);
  const axis = axisFor(rotation);
  return {
    min: position.map((v, i) => v - extents[i]),
    max: position.map((v, i) => v + extents[i]),
    radius:
      Math.hypot(position[0], position[2]) +
      diameter / 2 +
      ((0.13 * diameter * thicknessScale) / 2) * Math.hypot(axis[0], axis[2]),
    height: extents[1] * 2,
  };
}
export function chipStackBounds(specs) {
  if (!specs.length)
    return {
      min: [0, 0, 0],
      max: [0, 0, 0],
      radius: 0,
      height: 0,
      center: [0, 0, 0],
    };
  const min = [Infinity, Infinity, Infinity],
    max = [-Infinity, -Infinity, -Infinity];
  let radius = 0;
  for (const spec of specs) {
    const b = chipPoseBounds(spec);
    radius = Math.max(radius, b.radius);
    for (let i = 0; i < 3; i++) {
      min[i] = Math.min(min[i], b.min[i]);
      max[i] = Math.max(max[i], b.max[i]);
    }
  }
  return {
    min,
    max,
    radius,
    height: max[1] - min[1],
    center: min.map((v, i) => (v + max[i]) / 2),
  };
}
