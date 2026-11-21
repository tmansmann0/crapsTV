import test from "node:test";
import assert from "node:assert/strict";
import {
  BOARD_LAYOUT,
  BOARD_SPECIAL_REGIONS,
  boardPixelToWorld,
  boardWorldToPixel,
} from "../src/board-layout.js";
import { G } from "../assets/source/board-design/lib.mjs";
import { puckHome, PUCK_RADIUS } from "../src/puck-layout.js";
import { chipLocation } from "../src/wager-layout.js";
import { BOUNDS } from "../src/dice-physics.js";

test("printed ON rings and physical puck are centered in the gap above the numbers", () => {
  const panelBottom = Math.max(
    ...Object.values(BOARD_SPECIAL_REGIONS).map(
      ({ pixelRect: [, top, , height] }) => top + height,
    ),
  );
  const topGap = G.rail.y - G.rail.r - panelBottom;
  const bottomGap = G.nums.y0 - G.rail.y - G.rail.r;
  assert(Math.abs(topGap - bottomGap) < 1e-9);
  assert(topGap >= 11);
  for (const mode of ["craps", "crapless"]) {
    const [x, , z] = puckHome(6, mode).position;
    assert(Math.abs(boardWorldToPixel(x, z)[1] - G.rail.y) < 1e-9);
  }
});

test("the physical puck covers the outer stroke of both printed targets", () => {
  const puckRadiusInPrint =
    PUCK_RADIUS *
    Math.min(
      BOARD_LAYOUT.width / BOARD_LAYOUT.worldWidth,
      BOARD_LAYOUT.height / BOARD_LAYOUT.worldDepth,
    );
  assert(puckRadiusInPrint > G.rail.r + 1);
  assert(puckRadiusInPrint > G.rail.offRadius + 1.2);
});

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
