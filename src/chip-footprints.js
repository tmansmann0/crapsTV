import { Vector3 } from "three";
import { PUCK_HEIGHT, PUCK_RADIUS } from "./puck-layout.js";
import { chipPoseBounds } from "./chip-character.js";

export function puckFootprintBounds(pose) {
  const position = Array.isArray(pose.position)
    ? pose.position
    : [pose.position.x, pose.position.y, pose.position.z];
  const quaternion = Array.isArray(pose.quaternion)
    ? pose.quaternion
    : [
        pose.quaternion.x,
        pose.quaternion.y,
        pose.quaternion.z,
        pose.quaternion.w,
      ];
  const [x, y, z, w] = quaternion;
  const axis = [
    2 * (x * y - z * w),
    1 - 2 * (x * x + z * z),
    2 * (y * z + x * w),
  ];
  const extents = axis.map(
    (value) =>
      PUCK_RADIUS * Math.sqrt(Math.max(0, 1 - value * value)) +
      (PUCK_HEIGHT / 2) * Math.abs(value) +
      0.01,
  );
  return {
    id: "puck",
    min: position.map((value, i) => value - extents[i]),
    max: position.map((value, i) => value + extents[i]),
  };
}

/** Screen-space no-label regions for actual chip stacks and flying bundles. */
export function projectChipFootprints(
  stacks,
  camera,
  width,
  height,
  { motionPadding = 0, extraBounds = [] } = {},
) {
  const regions = new Map();
  const include = (id, min, max) => {
    if (!regions.has(id)) regions.set(id, { min: [...min], max: [...max] });
    else {
      const region = regions.get(id);
      for (let axis = 0; axis < 3; axis++) {
        region.min[axis] = Math.min(region.min[axis], min[axis]);
        region.max[axis] = Math.max(region.max[axis], max[axis]);
      }
    }
  };
  for (const stack of stacks) {
    const id = stack.id.startsWith("bank:")
      ? stack.id.slice(0, stack.id.lastIndexOf(":"))
      : stack.id;
    for (const chip of stack.chips) {
      const bounds = chipPoseBounds(chip);
      include(
        id,
        bounds.min.map((value) => value - motionPadding),
        bounds.max.map((value) => value + motionPadding),
      );
    }
  }
  include("dealer", [-1.1, 0.9, -3.3], [1.1, 1.35, -2.7]);
  extraBounds.forEach((box, index) =>
    include(box.id || `flight:${index}`, box.min, box.max),
  );
  const point = new Vector3(),
    rectangles = [];
  const pad = (4 * height) / 1080;
  for (const [id, region] of regions) {
    let left = Infinity,
      right = -Infinity,
      top = Infinity,
      bottom = -Infinity,
      visible = false;
    for (const x of region.min[0] === region.max[0]
      ? [region.min[0]]
      : [region.min[0], region.max[0]])
      for (const y of [region.min[1], region.max[1]])
        for (const z of [region.min[2], region.max[2]]) {
          point.set(x, y, z).project(camera);
          if (point.z >= -1 && point.z <= 1) visible = true;
          left = Math.min(left, ((point.x + 1) * width) / 2);
          right = Math.max(right, ((point.x + 1) * width) / 2);
          top = Math.min(top, ((1 - point.y) * height) / 2);
          bottom = Math.max(bottom, ((1 - point.y) * height) / 2);
        }
    if (!visible || right < 0 || left > width || bottom < 0 || top > height)
      continue;
    left = Math.max(0, left - pad);
    right = Math.min(width, right + pad);
    top = Math.max(0, top - pad);
    bottom = Math.min(height, bottom + pad);
    rectangles.push({
      id,
      source: "chips",
      x: left,
      y: top,
      width: right - left,
      height: bottom - top,
    });
  }
  return rectangles;
}
