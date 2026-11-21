import { BOARD_LAYOUT, legacyBoardToWorld } from "./board-layout.js";

export const PUCK_RADIUS = BOARD_LAYOUT.puck.radius;
export const PUCK_HEIGHT = 0.085;
export const PUCK_MASS = 0.18;

/** Same placement as the table marker; GLB +Y is ON and -Y is OFF. */
export function puckHome(point, mode = "craps") {
  const points =
    mode === "crapless"
      ? BOARD_LAYOUT.points.crapless
      : BOARD_LAYOUT.points.classic;
  const on = points.includes(point);
  const [rowStart, , rowWidth] = BOARD_LAYOUT.numberRow.legacy;
  const x = on
    ? legacyBoardToWorld(
        rowStart + ((points.indexOf(point) + 0.5) * rowWidth) / points.length,
        0,
      )[0]
    : BOARD_LAYOUT.puck.offWorld[0];
  const z = on ? BOARD_LAYOUT.puck.onWorldZ : BOARD_LAYOUT.puck.offWorld[1];
  return {
    id: "puck",
    point: on ? point : null,
    radius: PUCK_RADIUS,
    height: PUCK_HEIGHT,
    mass: PUCK_MASS,
    position: [x, PUCK_HEIGHT / 2 + 0.002, z],
    quaternion: on ? [0, 0, 0, 1] : [1, 0, 0, 0],
  };
}
