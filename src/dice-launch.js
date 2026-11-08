export const DICE_SIZE = 0.22;
export const DIE_BOUNDING_RADIUS = (Math.sqrt(3) * DICE_SIZE) / 2;
const LAUNCH_CLEARANCE = 0.01;

/** Clear every initial die orientation without consuming random values. */
export function diceLaunchPositions(
  gesture = {},
  { puck = null, stacks = [] } = {},
) {
  const aim = Math.max(-1, Math.min(1, gesture.x || 0));
  const power = Math.max(0, Math.min(1, gesture.power ?? 0.65));
  const supports = stacks.map((stack) => ({
    x: stack.position[0],
    z: stack.position[2],
    radius: stack.radius,
    top: stack.position[1] + stack.height / 2,
  }));
  if (puck) {
    const [x, y, z, w] = puck.quaternion;
    const lengthSquared = x * x + y * y + z * z + w * w;
    const vertical = Math.min(
      1,
      Math.abs(1 - (2 * (x * x + z * z)) / lengthSquared),
    );
    supports.push({
      x: puck.position[0],
      z: puck.position[2],
      radius: Math.hypot(puck.radius, puck.height / 2),
      top:
        puck.position[1] +
        (puck.height / 2) * vertical +
        puck.radius * Math.sqrt(1 - vertical * vertical),
    });
  }
  return [0, 1].map((i) => {
    const position = [
      aim * 0.55 + (i ? 0.19 : -0.19),
      0.23 + power * 0.16 + i * 0.03,
      1.9 - power * 0.15,
    ];
    for (const support of supports) {
      if (
        Math.hypot(position[0] - support.x, position[2] - support.z) <
        support.radius + DIE_BOUNDING_RADIUS + LAUNCH_CLEARANCE
      )
        position[1] = Math.max(
          position[1],
          support.top + DIE_BOUNDING_RADIUS + LAUNCH_CLEARANCE,
        );
    }
    return position;
  });
}
