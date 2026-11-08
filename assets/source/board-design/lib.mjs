// Shared geometry + drawing helpers for the crapsTV board concepts.
// All coordinates are actual SVG px: x = 1024+(legacyX-1024)*1588/1776, y = legacyY*.82+50.
import { readFileSync } from "node:fs";
import { BOARD_LAYOUT, legacyBoardToPixel } from "../../../src/board-layout.js";
const here = new URL(".", import.meta.url);
export const logoHref =
  "data:image/png;base64," +
  readFileSync(new URL("../../../public/assets/brand-logo.png", here)).toString(
    "base64",
  );

const SCALE = 1588 / 1776;
export const LX = (x) => legacyBoardToPixel(x, 0)[0];
export const LY = (y) => legacyBoardToPixel(0, y)[1];

export const G = {
  header: [9, 243],
  logo: { x: 879, y: 9, w: 290, h: 124 },
  modeBaseline: 150,
  rail: {
    y: BOARD_LAYOUT.puck.onPixelY,
    r: 38,
    off: BOARD_LAYOUT.puck.offPixel[0],
  },
  nums: {
    x0: LX(136),
    x1: LX(1912),
    y0: LY(242),
    y1: LY(400),
    list: [4, 5, 6, 8, 9, 10],
  },
  dc: [LX(136), LY(424), LX(456), LY(534)],
  hw: [LX(136), LY(548), LX(456), LY(794)],
  come: [LX(476), LY(424), LX(1576), LY(556)],
  field: [LX(476), LY(572), LX(1576), LY(794)],
  roll: [LX(1596), LY(424), LX(1912), LY(794)],
  big: {
    6: [LX(620), 660, LX(820), LY(794)],
    8: [LX(1220), 660, LX(1420), LY(794)],
  },
  pass: { L: 68, R: 1980, iL: 126, iR: 1922, top: 240, ib: 778, ob: 836 },
  dont: { L: 145, R: 1903, iL: 195, iR: 1853, top: 245, ib: 718, ob: 768 },
  apron: 836,
  // Line-chip slots leave this x span clear on both bottom lanes.
  laneClear: [860, 1188],
};
G.colW = (G.nums.x1 - G.nums.x0) / 6;
G.colX = (i) => G.nums.x0 + G.colW * (i + 0.5);
G.fieldX = (i) => G.field[0] + ((G.field[2] - G.field[0]) * (i + 0.5)) / 7;
G.hwCell = (i) => {
  const [x0, y0, x1, y1] = G.hw;
  const head = 36,
    w = (x1 - x0) / 2,
    h = (y1 - y0 - head) / 2;
  const cx = x0 + w * (i % 2),
    cy = y0 + head + h * (i >> 1);
  return [cx, cy, cx + w, cy + h];
};
// Prop rows are centred on the existing chip anchors (legacy y 520 + 67*row).
G.rollRows = [0, 1, 2, 3].map((r) => [
  LY(520 + 67 * r) - 27.47,
  LY(520 + 67 * r) + 27.47,
]);

export const PAY = {
  place: { 4: "9:5", 5: "7:5", 6: "7:6", 8: "7:6", 9: "7:5", 10: "9:5" },
  hard: { 4: "7:1", 6: "9:1", 8: "9:1", 10: "7:1" },
  props: [
    ["prop-7", "ANY 7", "4:1"],
    ["craps", "ANY CRAPS", "7:1"],
    ["prop-2", "2 / 12", "30:1 EACH"],
    ["prop-3", "3 / 11", "15:1 EACH"],
  ],
};

export const esc = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");
const n = (v) => +(+v).toFixed(2);

export function T(str, x, y, o = {}) {
  const {
    f = "Georgia, serif",
    s = 20,
    w = 400,
    fill = "#fff",
    ls = 0,
    a = "middle",
    it = false,
    extra = "",
  } = o;
  const adj = a === "middle" ? ls / 2 : a === "end" ? ls : 0; // cancel trailing tracking
  return `<text x="${n(x + adj)}" y="${n(y)}" text-anchor="${a}" font-family="${f}" font-size="${s}" font-weight="${w}"${it ? ' font-style="italic"' : ""} fill="${fill}"${ls ? ` letter-spacing="${ls}"` : ""} ${extra}>${esc(str)}</text>`;
}
// Rotated label, optically centred on (cx,cy). angle +90 on the left, -90 on the right.
export function RT(str, cx, cy, angle, o = {}) {
  const s = o.s || 20,
    capH = (o.cap || 0.7) * s,
    ls = o.ls || 0;
  const bx = cx - Math.sign(angle) * capH * 0.5;
  return `<g transform="rotate(${angle} ${n(bx)} ${n(cy)})">${T(str, bx, cy, { ...o, ls })}</g>`;
}
const PIPS = {
  1: [[0, 0]],
  2: [
    [-1, -1],
    [1, 1],
  ],
  3: [
    [-1, -1],
    [0, 0],
    [1, 1],
  ],
  4: [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ],
  5: [
    [-1, -1],
    [1, -1],
    [0, 0],
    [-1, 1],
    [1, 1],
  ],
  6: [
    [-1, -1],
    [1, -1],
    [-1, 0],
    [1, 0],
    [-1, 1],
    [1, 1],
  ],
};
export function die(x, y, v, size, o = {}) {
  const {
    face = "#f1e7ce",
    pip = "#2a0a0e",
    edge = "none",
    rx = size * 0.17,
    sw = 1,
    shade,
  } = o;
  let out = shade
    ? `<rect x="${n(x - size / 2 + 2)}" y="${n(y - size / 2 + 2.5)}" width="${size}" height="${size}" rx="${n(rx)}" fill="${shade}"/>`
    : "";
  out += `<rect x="${n(x - size / 2)}" y="${n(y - size / 2)}" width="${size}" height="${size}" rx="${n(rx)}" fill="${face}" stroke="${edge}" stroke-width="${sw}"/>`;
  for (const [px, py] of PIPS[v])
    out += `<circle cx="${n(x + px * size * 0.26)}" cy="${n(y + py * size * 0.26)}" r="${n(size * 0.095)}" fill="${pip}"/>`;
  return `<g class="die" data-value="${v}">${out}</g>`;
}
export const pair = (x, y, v, size, o = {}) =>
  die(x - size * 0.58, y, v, size, o) + die(x + size * 0.58, y, v, size, o);

export const R = (x0, y0, x1, y1, o = {}) => {
  const { rx = 0, fill = "none", stroke = "none", sw = 1, op, extra = "" } = o;
  return `<rect x="${n(x0)}" y="${n(y0)}" width="${n(x1 - x0)}" height="${n(y1 - y0)}"${rx ? ` rx="${rx}"` : ""} fill="${fill}" stroke="${stroke}" stroke-width="${sw}"${op != null ? ` opacity="${op}"` : ""} ${extra}/>`;
};
let engravingClip = 0;
export const P = (d, o = {}) => {
  const { fill = "none", stroke = "none", sw = 1, op, extra = "" } = o;
  if (fill === "url(#a-hatch)" || fill === "url(#a-hatch-ox)") {
    const ox = fill.endsWith("-ox)"),
      id = `engraving-clip-${++engravingClip}`;
    return `<g>${P(d, { fill: ox ? "#5a0f18" : "#072b21" })}<clipPath id="${id}"><path d="${d}"/></clipPath><use href="#ink-lines-${ox ? "ox" : "emerald"}" stroke="${ox ? "#5f161c" : "#0e2f23"}" clip-path="url(#${id})"/>${P(d, { ...o, fill: "none" })}</g>`;
  }
  return `<path d="${d}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"${op != null ? ` opacity="${op}"` : ""} ${extra}/>`;
};
export const L = (x0, y0, x1, y1, stroke, sw = 1, op) =>
  `<line x1="${n(x0)}" y1="${n(y0)}" x2="${n(x1)}" y2="${n(y1)}" stroke="${stroke}" stroke-width="${sw}"${op != null ? ` opacity="${op}"` : ""}/>`;
export const C = (x, y, r, o = {}) => {
  const { fill = "none", stroke = "none", sw = 1, op } = o;
  return `<circle cx="${n(x)}" cy="${n(y)}" r="${r}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"${op != null ? ` opacity="${op}"` : ""}/>`;
};
// Ticket cartouche: rectangle with concave corners.
export function ticket(x0, y0, x1, y1, c) {
  return `M${n(x0 + c)} ${n(y0)} H${n(x1 - c)} A${c} ${c} 0 0 0 ${n(x1)} ${n(y0 + c)} V${n(y1 - c)} A${c} ${c} 0 0 0 ${n(x1 - c)} ${n(y1)} H${n(x0 + c)} A${c} ${c} 0 0 0 ${n(x0)} ${n(y1 - c)} V${n(y0 + c)} A${c} ${c} 0 0 0 ${n(x0 + c)} ${n(y0)} Z`;
}
// Deco stepped corners.
export function stepped(x0, y0, x1, y1, c) {
  const s = c / 2;
  return `M${n(x0 + c)} ${n(y0)} H${n(x1 - c)} V${n(y0 + s)} H${n(x1 - s)} V${n(y0 + c)} H${n(x1)} V${n(y1 - c)} H${n(x1 - s)} V${n(y1 - s)} H${n(x1 - c)} V${n(y1)} H${n(x0 + c)} V${n(y1 - s)} H${n(x0 + s)} V${n(y1 - c)} H${n(x0)} V${n(y0 + c)} H${n(x0 + s)} V${n(y0 + s)} H${n(x0 + c)} Z`;
}
export const chamfer = (x0, y0, x1, y1, c) =>
  `M${n(x0 + c)} ${n(y0)} H${n(x1 - c)} L${n(x1)} ${n(y0 + c)} V${n(y1 - c)} L${n(x1 - c)} ${n(y1)} H${n(x0 + c)} L${n(x0)} ${n(y1 - c)} V${n(y0 + c)} Z`;

// Continuous U lane. inset shrinks it symmetrically for inline rules.
export function lane(
  g,
  { ro = 36, ri = 8, style = "round", inset = 0, topInset = inset } = {},
) {
  const Lx = g.L + inset,
    Rx = g.R - inset,
    iL = g.iL - inset,
    iR = g.iR + inset,
    t = g.top + topInset,
    ib = g.ib + inset,
    ob = g.ob - inset;
  const co = Math.max(ro - inset, 2),
    ci = Math.max(ri + inset, 2);
  const turn =
    style === "chamfer"
      ? { a: (x, y) => `L${n(x)} ${n(y)}`, b: () => "" }
      : null;
  const q = (cx, cy, x, y) =>
    turn ? `L${n(x)} ${n(y)}` : `Q${n(cx)} ${n(cy)} ${n(x)} ${n(y)}`;
  return `M${n(Lx)} ${n(t)} H${n(iL)} V${n(ib - ci)} ${q(iL, ib, iL + ci, ib)} H${n(iR - ci)} ${q(iR, ib, iR, ib - ci)} V${n(t)} H${n(Rx)} V${n(ob - co)} ${q(Rx, ob, Rx - co, ob)} H${n(Lx + co)} ${q(Lx, ob, Lx, ob - co)} Z`;
}
export const bet = (id, name, rect, content) =>
  `<g id="bet-${id}" data-bet="${id}" data-name="${esc(name)}" data-rect="${rect.map(n).join(" ")}">${content}</g>`;
export const logo = () => {
  const { x, y, w, h } = G.logo;
  return `<image id="brand-logo" href="${logoHref}" x="${x}" y="${y}" width="${w}" height="${h}" preserveAspectRatio="xMidYMid meet"/>`;
};
export const wrap = (title, desc, defs, ground, body) =>
  `<?xml version="1.0" encoding="utf-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="2048" height="1024" viewBox="0 0 2048 1024">
<title>${esc(title)}</title><desc>${esc(desc)}</desc>
<defs>${defs}</defs>
<rect id="felt" width="2048" height="1024" rx="160" fill="${ground}"/>
${body}
</svg>
`;
