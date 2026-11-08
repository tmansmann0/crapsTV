import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  BOARD_LAYOUT,
  BOARD_BET_SHIFT_Z,
  legacyBoardToPixel,
  legacyBoardToWorld,
} from "../src/board-layout.js";
import { catalogue, createState } from "../src/game.js";
import { chipLocation } from "../src/wager-layout.js";

const manifest = JSON.parse(
  readFileSync(new URL("../public/assets/board-layout.json", import.meta.url)),
);
test("board reserves the new header without changing horizontal bet positions", () => {
  assert.equal(BOARD_BET_SHIFT_Z, 0.263671875);
  for (const [x, y] of [
    [136, 290],
    [1024, 710],
    [1912, 920],
    [1024, 1085],
  ]) {
    const [worldX, worldZ] = legacyBoardToWorld(x, y);
    assert(Math.abs(worldX - (x / 2048 - 0.5) * 10.84 * (1588 / 1776)) < 1e-12);
    assert(
      Math.abs(worldZ - (((y * 0.82) / 1024 - 0.5) * 5.4 + BOARD_BET_SHIFT_Z)) <
        1e-12,
    );
  }
  assert(
    legacyBoardToPixel(1024, 1085)[1] < 1024,
    "Pass odds remain on the real apron",
  );
  assert(BOARD_LAYOUT.lanes.apron[1] - BOARD_LAYOUT.lanes.apron[0] >= 180);
});

test("every supported wager has an editable semantic region and the same physical anchor", () => {
  for (const mode of ["classic", "crapless"]) {
    const entry = manifest.modes[mode];
    const state = createState("BOARDQA");
    state.config.mode = mode === "classic" ? "craps" : "crapless";
    for (const bet of catalogue(state))
      assert(entry.regions[bet.id], `${mode} ${bet.id} has artwork`);
    for (const [id, anchor] of Object.entries(entry.anchors)) {
      const point = chipLocation(anchor.bet, state.config.mode);
      for (let axis = 0; axis < 2; axis++)
        assert(
          Math.abs(point[axis] - anchor.world[axis]) < 1e-10,
          `${mode} ${id} runtime matches vector art`,
        );
      assert(
        anchor.pixel[0] >= 0 &&
          anchor.pixel[0] <= 2048 &&
          anchor.pixel[1] >= 0 &&
          anchor.pixel[1] <= 1024,
        `${mode} ${id} on felt`,
      );
    }
  }
  assert.equal(manifest.betOffsetY, BOARD_LAYOUT.betOffsetY);
});

test("classic and crapless SVGs keep corrected side line orientation and a clear logo header", () => {
  for (const mode of ["classic", "crapless"]) {
    const svg = readFileSync(
      new URL(`../public/assets/board-${mode}.svg`, import.meta.url),
      "utf8",
    );
    const master = readFileSync(
      new URL(
        `../assets/source/board-design/text/board-${mode}.svg`,
        import.meta.url,
      ),
      "utf8",
    );
    assert(svg.includes('data-layout-version="2"'));
    const ids = [...svg.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
    assert.equal(
      ids.length,
      new Set(ids).size,
      "editable vector IDs stay unique",
    );
    assert.match(master, /data-side="left"[^>]*transform="rotate\(90 /);
    assert.match(master, /data-side="right"[^>]*transform="rotate\(-90 /);
    assert(
      !/<text\b|<font\b/.test(svg),
      "production glyphs are vector outlines, without system font dependencies",
    );
    assert(
      (svg.match(/<image\b/g) || []).length <= 2,
      "only the original logo and its alpha mask are raster; engraving stays vector",
    );
    assert.equal(manifest.logo.y + manifest.logo.height, 133);
    assert(manifest.modes[mode].regions["place-4"].pixelRect[1] >= 248);
    for (const id of Object.keys(manifest.modes[mode].regions))
      assert(
        svg.includes(`data-bet-id="${id}"`),
        `${mode} ${id} is editable vector group`,
      );
  }
});
