export const PUCK_RADIUS = 0.2;
export const PUCK_HEIGHT = 0.085;
export const PUCK_MASS = 0.18;

/** Same placement as the table marker; GLB +Y is ON and -Y is OFF. */
export function puckHome(point, mode = "craps") {
  const points =
    mode === "crapless"
      ? [2, 3, 4, 5, 6, 8, 9, 10, 11, 12]
      : [4, 5, 6, 8, 9, 10];
  const on = points.includes(point);
  const x = on
    ? ((136 + ((points.indexOf(point) + 0.5) * 1776) / points.length) / 2048 -
        0.5) *
      10.84 *
      (1588 / 1776)
    : -4;
  return {
    id: "puck",
    point: on ? point : null,
    radius: PUCK_RADIUS,
    height: PUCK_HEIGHT,
    mass: PUCK_MASS,
    position: [x, PUCK_HEIGHT / 2 + 0.002, on ? -1.62 : -2.05],
    quaternion: on ? [0, 0, 0, 1] : [1, 0, 0, 0],
  };
}
