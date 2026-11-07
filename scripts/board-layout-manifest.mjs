// Emit the semantic artwork map from the same transform the renderer imports.
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  BOARD_LAYOUT,
  legacyBoardToPixel,
  legacyBoardToWorld,
} from "../src/board-layout.js";
const root = new URL("../", import.meta.url);
const map = { ...BOARD_LAYOUT, modes: {} };
for (const mode of ["classic", "crapless"]) {
  const points = BOARD_LAYOUT.points[mode],
    regions = {},
    anchors = {};
  function add(id, bet, x, y, rect) {
    const [left, top] = legacyBoardToPixel(rect[0], rect[1]);
    regions[id] = {
      pixelRect: [
        left,
        top,
        rect[2] * BOARD_LAYOUT.xScale,
        rect[3] * BOARD_LAYOUT.yScale,
      ],
    };
    anchors[id] = {
      bet,
      legacy: [x, y],
      pixel: legacyBoardToPixel(x, y),
      world: legacyBoardToWorld(x, y),
    };
  }
  for (const [index, point] of points.entries()) {
    const width = 1776 / points.length,
      x = 136 + (index + 0.5) * width;
    const rect = [136 + index * width, 242, width, 158];
    add(`place-${point}`, { type: `place-${point}` }, x, 290, rect);
    add(`come-point-${point}`, { type: "come", point }, x, 345, rect);
    if (mode === "classic")
      add(`dontcome-point-${point}`, { type: "dontcome", point }, x, 345, rect);
    add(
      `odds-${point}`,
      { type: "odds", point, parentType: "come" },
      x,
      380,
      rect,
    );
  }
  add("pass", { type: "pass" }, 1024, 920, [0, 0, 2048, 1024]);
  regions.pass.pixelRects =
    mode === "classic"
      ? [
          [68, 240, 58, 560],
          [1922, 240, 58, 560],
          [104, 778, 1840, 58],
        ]
      : [
          [68, 240, 127, 560],
          [1853, 240, 127, 560],
          [104, 778, 1840, 58],
        ];
  regions.pass.pixelRect = [68, 240, 1912, 596];
  add(
    "pass-odds",
    { type: "odds", point: 6, parentType: "pass" },
    1024,
    1085,
    [136, 1000, 1776, 180],
  );
  regions["pass-odds"].pixelRect = [68, 836, 1912, 188];
  if (mode === "classic") {
    add("dont", { type: "dont" }, 1024, 840, [0, 0, 2048, 1024]);
    regions.dont.pixelRect = [145, 245, 1758, 523];
    regions.dont.pixelRects = [
      [145, 245, 50, 468],
      [1853, 245, 50, 468],
      [180, 718, 1688, 50],
    ];
    add("dontcome", { type: "dontcome" }, 285, 465, [136, 424, 320, 110]);
  }
  const centerX = mode === "classic" ? 476 : 136;
  const centerWidth = mode === "classic" ? 1100 : 1440;
  add("come", { type: "come" }, 1024, 470, [centerX, 424, centerWidth, 132]);
  add("field", { type: "field" }, 1024, 710, [centerX, 572, centerWidth, 222]);
  for (const [index, total] of [4, 6, 8, 10].entries()) {
    const classic = mode === "classic";
    add(
      `hard-${total}`,
      { type: `hard-${total}` },
      classic ? (index % 2 ? 370 : 210) : 1671,
      classic ? (index < 2 ? 640 : 735) : 520 + index * 67,
      classic
        ? [136 + (index % 2) * 160, index < 2 ? 610 : 705, 160, 89]
        : [1596, 495 + index * 67, 150, 67],
    );
  }
  for (const total of [2, 3, 7, 11, 12]) {
    const row = total === 7 ? 0 : [2, 12].includes(total) ? 2 : 3;
    add(
      `prop-${total}`,
      { type: `prop-${total}` },
      mode === "classic" ? 1750 : 1837,
      520 + row * 67,
      [
        mode === "classic" ? 1596 : 1762,
        495 + row * 67,
        mode === "classic" ? 316 : 150,
        67,
      ],
    );
  }
  add("craps", { type: "craps" }, mode === "classic" ? 1750 : 1837, 587, [
    mode === "classic" ? 1596 : 1762,
    562,
    mode === "classic" ? 316 : 150,
    67,
  ]);
  for (const point of [6, 8]) {
    const x = point === 6 ? 720 : 1320;
    add(`big-${point}`, { type: `big-${point}` }, x, 785, [
      x - 100,
      762,
      200,
      32,
    ]);
  }
  map.modes[mode] = { regions, anchors };
}
if (process.argv.includes("--annotate"))
  for (const mode of ["classic", "crapless"]) {
    const path = new URL(`public/assets/board-${mode}.svg`, root);
    let svg = await readFile(path, "utf8");
    const semanticSource = process.argv.includes("--master")
      ? await readFile(
          new URL(`assets/source/board-design/text/board-${mode}.svg`, root),
          "utf8",
        )
      : svg;
    // Visible vector groups carry their exact printed bounds. Keep shared and
    // traveled-bet aliases tied to those regions without moving their anchors.
    for (const tag of semanticSource.matchAll(/<g\b[^>]*>/g)) {
      const id = tag[0].match(/\sid="bet-([^"]+)"/)?.[1];
      const bounds = tag[0]
        .match(/\sdata-rect="([^"]+)"/)?.[1]
        ?.split(/\s+/)
        .map(Number);
      if (map.modes[mode].regions[id] && bounds?.length === 4) {
        const [x0, y0, x1, y1] = bounds;
        map.modes[mode].regions[id].pixelRect = [x0, y0, x1 - x0, y1 - y0];
      }
    }
    for (const [alias, source] of [
      ["prop-12", "prop-2"],
      ["prop-11", "prop-3"],
    ])
      map.modes[mode].regions[alias].pixelRect = [
        ...map.modes[mode].regions[source].pixelRect,
      ];
    svg = svg
      .replace(/\sdata-layout-version="[^"]*"/, "")
      .replace(/<svg\b/, '<svg data-layout-version="2"');
    svg = svg.replace(
      /<(g|text)\b([^>]*?)transform="rotate\((90|-90) ([^"]+)\)"([^>]*)>/g,
      (tag, kind, before, angle, center, after) =>
        tag.includes("data-side=")
          ? tag
          : `<${kind} data-side="${angle === "90" ? "left" : "right"}"${before}transform="rotate(${angle} ${center})"${after}>`,
    );
    svg = svg.replace(
      /\s*<!-- semantic-bet-map -->[\s\S]*?<!-- end-semantic-bet-map -->/,
      "",
    );
    const groups = Object.entries(map.modes[mode].regions)
      .map(([id, region]) => {
        const actualGroup = new RegExp(`<g\\b([^>]*\\bid="bet-${id}"[^>]*)>`);
        if (actualGroup.test(svg)) {
          svg = svg.replace(actualGroup, (tag, attributes) =>
            tag.includes("data-bet-id=")
              ? tag
              : `<g data-bet-id="${id}"${attributes}>`,
          );
          return "";
        }
        const [x, y, width, height] = region.pixelRect;
        return `<g id="region-${id}" data-bet-id="${id}"><desc>Shared or traveled wager region; anchor in board-layout.json</desc><rect x="${x}" y="${y}" width="${width}" height="${height}" fill="none" stroke="none"/></g>`;
      })
      .join("\n");
    svg = svg.replace(
      /<\/svg>\s*$/,
      `<!-- semantic-bet-map -->\n<g pointer-events="none">${groups}</g>\n<!-- end-semantic-bet-map -->\n</svg>`,
    );
    await writeFile(path, svg);
  }
await writeFile(
  new URL("public/assets/board-layout.json", root),
  JSON.stringify(map, null, 2) + "\n",
);
const layoutPath = new URL("src/board-layout.js", root);
const packingRegions = Object.fromEntries(
  Object.entries(map.modes).map(([mode, value]) => [
    mode,
    Object.fromEntries(
      Object.entries(value.regions)
        .filter(([id]) => !id.includes("-point-") && !id.startsWith("odds-"))
        .map(([id, region]) => [id, region]),
    ),
  ]),
);
const generated = `// BEGIN GENERATED BOARD REGIONS\n// Generated from the editable vector groups by scripts/board-layout-manifest.mjs.\nexport const BOARD_BET_REGIONS = Object.freeze(${JSON.stringify(packingRegions, null, 2)});\n// END GENERATED BOARD REGIONS\n`;
const layoutSource = (await readFile(layoutPath, "utf8")).replace(
  /\n?\/\/ BEGIN GENERATED BOARD REGIONS[\s\S]*?\/\/ END GENERATED BOARD REGIONS\n?/,
  "",
);
await writeFile(layoutPath, layoutSource + "\n" + generated);
console.log(
  `Wrote ${fileURLToPath(new URL("public/assets/board-layout.json", root))}`,
);
