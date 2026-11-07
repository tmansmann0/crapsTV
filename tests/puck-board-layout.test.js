import test from "node:test";
import assert from "node:assert/strict";
import { BOARD_LAYOUT, boardPixelToWorld } from "../src/board-layout.js";
import { puckHome, PUCK_RADIUS } from "../src/puck-layout.js";
import { chipLocation } from "../src/wager-layout.js";
import { BOUNDS } from "../src/dice-physics.js";

test("every ON puck clears the full branding band and the shifted number row", () => {
  const logo = BOARD_LAYOUT.logo;
  const [left, top] = boardPixelToWorld(logo.x, logo.y);
  const [right, bottom] = boardPixelToWorld(logo.x + logo.width, 150);
  const numberTop = boardPixelToWorld(0, 248)[1];
  for (const mode of ["craps", "crapless"]) {
    const points =
      mode === "crapless"
        ? BOARD_LAYOUT.points.crapless
        : BOARD_LAYOUT.points.classic;
    for (const point of points) {
      const {
        position: [x, , z],
      } = puckHome(point, mode);
      const dx = Math.max(left - x, 0, x - right);
      const dz = Math.max(top - z, 0, z - bottom);
      assert(
        Math.hypot(dx, dz) > PUCK_RADIUS,
        `${mode} ${point} leaves the logo and mode line clear`,
      );
      assert(
        z + PUCK_RADIUS < numberTop,
        `${mode} ${point} leaves the number row clear`,
      );
      assert(
        Math.abs(x - chipLocation({ type: `place-${point}` }, mode)[0]) < 1e-10,
      );
    }
  }
});

test("Pass odds leave room for their physical chips below the line and inside the cushion", () => {
  for (const mode of ["craps", "crapless"]) {
    const pass = chipLocation({ type: "pass" }, mode);
    const odds = chipLocation(
      { type: "odds", parentType: "pass", point: 6 },
      mode,
    );
    assert(odds[1] - pass[1] > 0.5);
    assert(odds[1] + 0.17 < BOUNDS.z);
  }
});
