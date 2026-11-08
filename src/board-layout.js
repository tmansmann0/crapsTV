// Shared artwork/physics coordinate contract. Legacy bet coordinates are kept
// stable; this transform reserves the new branding and ON-puck header band.
export const BOARD_WIDTH = 2048;
export const BOARD_HEIGHT = 1024;
export const BOARD_X_SCALE = 1588 / 1776;
export const BOARD_Y_SCALE = 0.82;
export const BOARD_BET_OFFSET_Y = 50;
export const BOARD_WORLD_WIDTH = 10.84;
export const BOARD_WORLD_DEPTH = 5.4;
export const BOARD_BET_SHIFT_Z =
  (BOARD_BET_OFFSET_Y / BOARD_HEIGHT) * BOARD_WORLD_DEPTH;

export function legacyBoardToPixel(x, y) {
  return [
    BOARD_WIDTH / 2 + (x - BOARD_WIDTH / 2) * BOARD_X_SCALE,
    y * BOARD_Y_SCALE + BOARD_BET_OFFSET_Y,
  ];
}
export function boardPixelToWorld(x, y) {
  return [
    (x / BOARD_WIDTH - 0.5) * BOARD_WORLD_WIDTH,
    (y / BOARD_HEIGHT - 0.5) * BOARD_WORLD_DEPTH,
  ];
}
export function legacyBoardToWorld(x, y) {
  return boardPixelToWorld(...legacyBoardToPixel(x, y));
}
export function boardWorldToPixel(x, z) {
  return [
    (x / BOARD_WORLD_WIDTH + 0.5) * BOARD_WIDTH,
    (z / BOARD_WORLD_DEPTH + 0.5) * BOARD_HEIGHT,
  ];
}
export const BOARD_LAYOUT = Object.freeze({
  version: 2,
  width: BOARD_WIDTH,
  height: BOARD_HEIGHT,
  xScale: BOARD_X_SCALE,
  yScale: BOARD_Y_SCALE,
  betOffsetY: BOARD_BET_OFFSET_Y,
  worldWidth: BOARD_WORLD_WIDTH,
  worldDepth: BOARD_WORLD_DEPTH,
  betShiftZ: BOARD_BET_SHIFT_Z,
  logo: { x: 879, y: 9, width: 290, height: 124 },
  puck: {
    radius: 0.2,
    onPixelY: 204.8,
    onWorldZ: -1.62,
    offWorld: [-4, -2.05],
    offPixel: boardWorldToPixel(-4, -2.05),
  },
  numberRow: { legacy: [136, 242, 1776, 158] },
  lanes: { passBottom: [778, 836], dontBottom: [718, 768], apron: [836, 1024] },
  points: {
    classic: [4, 5, 6, 8, 9, 10],
    crapless: [2, 3, 4, 5, 6, 8, 9, 10, 11, 12],
  },
});

// BEGIN GENERATED BOARD REGIONS
// Generated from the editable vector groups by scripts/board-layout-manifest.mjs.
export const BOARD_BET_REGIONS = Object.freeze({
  classic: {
    "place-4": {
      pixelRect: [230, 248.44, 264.67, 129.56],
    },
    "place-5": {
      pixelRect: [494.67, 248.44, 264.66, 129.56],
    },
    "place-6": {
      pixelRect: [759.33, 248.44, 264.66999999999996, 129.56],
    },
    "place-8": {
      pixelRect: [1024, 248.44, 264.6700000000001, 129.56],
    },
    "place-9": {
      pixelRect: [1288.67, 248.44, 264.65999999999985, 129.56],
    },
    "place-10": {
      pixelRect: [1553.33, 248.44, 264.6700000000001, 129.56],
    },
    pass: {
      pixelRect: [68, 240, 1912, 596],
      pixelRects: [
        [68, 240, 58, 560],
        [1922, 240, 58, 560],
        [104, 778, 1840, 58],
      ],
    },
    "pass-odds": {
      pixelRect: [68, 836, 1912, 188],
    },
    dont: {
      pixelRect: [145, 245, 1758, 523],
      pixelRects: [
        [145, 245, 50, 468],
        [1853, 245, 50, 468],
        [180, 718, 1688, 50],
      ],
    },
    dontcome: {
      pixelRect: [230, 397.68, 286.13, 90.19999999999999],
    },
    come: {
      pixelRect: [534.01, 397.68, 983.56, 108.24000000000001],
    },
    field: {
      pixelRect: [534.01, 519.04, 983.56, 182.04000000000008],
    },
    "hard-4": {
      pixelRect: [230, 535.36, 143.06, 82.86000000000001],
    },
    "hard-6": {
      pixelRect: [373.06, 535.36, 143.07, 82.86000000000001],
    },
    "hard-8": {
      pixelRect: [230, 618.22, 143.06, 82.86000000000001],
    },
    "hard-10": {
      pixelRect: [373.06, 618.22, 143.07, 82.86000000000001],
    },
    "prop-2": {
      pixelRect: [1535.45, 558.81, 282.54999999999995, 54.940000000000055],
    },
    "prop-3": {
      pixelRect: [1535.45, 613.75, 282.54999999999995, 54.940000000000055],
    },
    "prop-7": {
      pixelRect: [1535.45, 448.93, 282.54999999999995, 54.94],
    },
    "prop-11": {
      pixelRect: [1535.45, 613.75, 282.54999999999995, 54.940000000000055],
    },
    "prop-12": {
      pixelRect: [1535.45, 558.81, 282.54999999999995, 54.940000000000055],
    },
    craps: {
      pixelRect: [1535.45, 503.87, 282.54999999999995, 54.93999999999994],
    },
    "big-6": {
      pixelRect: [662.77, 660, 178.82000000000005, 41.08000000000004],
    },
    "big-8": {
      pixelRect: [1199.25, 660, 178.82999999999993, 41.08000000000004],
    },
  },
  crapless: {
    "place-2": {
      pixelRect: [230, 248.44, 158.8, 129.56],
    },
    "place-3": {
      pixelRect: [388.8, 248.44, 158.8, 129.56],
    },
    "place-4": {
      pixelRect: [547.6, 248.44, 158.79999999999995, 129.56],
    },
    "place-5": {
      pixelRect: [706.4, 248.44, 158.80000000000007, 129.56],
    },
    "place-6": {
      pixelRect: [865.2, 248.44, 158.79999999999995, 129.56],
    },
    "place-8": {
      pixelRect: [1024, 248.44, 158.79999999999995, 129.56],
    },
    "place-9": {
      pixelRect: [1182.8, 248.44, 158.79999999999995, 129.56],
    },
    "place-10": {
      pixelRect: [1341.6, 248.44, 158.80000000000018, 129.56],
    },
    "place-11": {
      pixelRect: [1500.4, 248.44, 158.79999999999995, 129.56],
    },
    "place-12": {
      pixelRect: [1659.2, 248.44, 158.79999999999995, 129.56],
    },
    pass: {
      pixelRect: [68, 240, 1912, 596],
      pixelRects: [
        [68, 240, 127, 560],
        [1853, 240, 127, 560],
        [104, 778, 1840, 58],
      ],
    },
    "pass-odds": {
      pixelRect: [68, 836, 1912, 188],
    },
    come: {
      pixelRect: [230, 397.68, 1287.57, 108.24000000000001],
    },
    field: {
      pixelRect: [230, 519.04, 1287.57, 182.04000000000008],
    },
    "hard-4": {
      pixelRect: [1535.45, 448.93, 134.1199999999999, 54.94],
    },
    "hard-6": {
      pixelRect: [1535.45, 503.87, 134.1199999999999, 54.93999999999994],
    },
    "hard-8": {
      pixelRect: [1535.45, 558.81, 134.1199999999999, 54.940000000000055],
    },
    "hard-10": {
      pixelRect: [1535.45, 613.75, 134.1199999999999, 54.940000000000055],
    },
    "prop-2": {
      pixelRect: [1683.88, 558.81, 134.1199999999999, 54.940000000000055],
    },
    "prop-3": {
      pixelRect: [1683.88, 613.75, 134.1199999999999, 54.940000000000055],
    },
    "prop-7": {
      pixelRect: [1683.88, 448.93, 134.1199999999999, 54.94],
    },
    "prop-11": {
      pixelRect: [1683.88, 613.75, 134.1199999999999, 54.940000000000055],
    },
    "prop-12": {
      pixelRect: [1683.88, 558.81, 134.1199999999999, 54.940000000000055],
    },
    craps: {
      pixelRect: [1683.88, 503.87, 134.1199999999999, 54.93999999999994],
    },
    "big-6": {
      pixelRect: [662.77, 660, 178.82000000000005, 41.08000000000004],
    },
    "big-8": {
      pixelRect: [1199.25, 660, 178.82999999999993, 41.08000000000004],
    },
  },
});
// END GENERATED BOARD REGIONS
