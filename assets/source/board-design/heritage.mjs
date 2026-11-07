// A — Heritage Engraved Emerald (selected direction). build() = classic, buildCrapless() = crapless.
// Header, puck targets and apron are shared; only the betting regions differ between modes.
import {
  G,
  LX,
  LY,
  PAY,
  T,
  RT,
  die,
  pair,
  R,
  P,
  L,
  C,
  ticket,
  lane,
  bet,
  logo,
  wrap,
} from "./lib.mjs";
import { BOARD_LAYOUT } from "../../../src/board-layout.js";
const c = {
  ground: "#0a3a2d",
  deep: "#072b21",
  ox: "#5a0f18",
  oxD: "#430a11",
  brass: "#c6a660",
  hi: "#e6d096",
  ivory: "#f3e9d0",
};
const cap = "Copperplate, 'Copperplate Gothic', 'Times New Roman', serif";
const cas = "'Big Caslon', 'Hoefler Text', Georgia, serif"; // letters only: its figures are old-style
const bas = "Baskerville, 'Hoefler Text', Georgia, serif"; // lining figures, all numerals
// Printed puck targets. Runtime OFF puck: world (-4, -2.05) => SVG (268.3, 123.3).
const OFF = {
  x: BOARD_LAYOUT.puck.offPixel[0],
  y: BOARD_LAYOUT.puck.offPixel[1],
  r: 38,
};
const PLACE_PAY = {
  2: "11:2",
  3: "11:4",
  4: "9:5",
  5: "7:5",
  6: "7:6",
  8: "7:6",
  9: "7:5",
  10: "9:5",
  11: "11:4",
  12: "11:2",
};

// Explicit clipped vector strokes survive PDF/SVG outlining without raster
// pattern tiles. Ink colours equal the former 3.5%-opacity print over each fill.
const engraving = (reverse = false) =>
  Array.from({ length: 365 }, (_, index) => {
    const x = -1024 + index * 8.5;
    return reverse
      ? `M${2048 - x} 0 L${1024 - x} 1024`
      : `M${x} 0 L${x + 1024} 1024`;
  }).join(" ");
const defs = `<path id="ink-lines-emerald" d="${engraving()}" fill="none" stroke-width="0.45"/><path id="ink-lines-ox" d="${engraving(true)}" fill="none" stroke-width="0.45"/>`;
const frame = (x0, y0, x1, y1, k = 12, fill = "url(#a-hatch)") =>
  P(ticket(x0, y0, x1, y1, k), { fill, stroke: c.brass, sw: 2.4 }) +
  P(ticket(x0 + 5, y0 + 5, x1 - 5, y1 - 5, k), {
    stroke: c.brass,
    sw: 0.9,
    op: 0.75,
  });
const rules = (x0, x1, y) =>
  L(x0, y, x1, y, c.brass, 2.6) + L(x0, y + 6, x1, y + 6, c.brass, 0.9);
const shade = (str, x, y, o) =>
  T(str, x + 3, y + 3, { ...o, fill: o.sh || c.oxD, extra: 'data-shade="1"' }) +
  T(str, x, y, o);

function header(mode, colXs, pointCaption) {
  let h = "";
  // Quiet symmetric print rules reserve actual headroom for the brand and puck.
  h += rules(352, 824, 96) + rules(1224, 1696, 96);
  h += T(mode, 1024, G.modeBaseline, {
    f: cap,
    s: 17,
    w: 700,
    fill: c.hi,
    ls: 4,
  });
  // OFF target sits on its own at the runtime OFF position.
  h += `<g id="puck-off" data-rect="${OFF.x - OFF.r} ${OFF.y - OFF.r} ${OFF.x + OFF.r} ${OFF.y + OFF.r}">${C(OFF.x, OFF.y, OFF.r, { fill: c.ox, stroke: c.brass, sw: 2.4 })}${C(OFF.x, OFF.y, OFF.r - 6, { stroke: c.hi, sw: 0.9, op: 0.8 })}${T("OFF", OFF.x, OFF.y + 8, { f: cap, s: 22, w: 700, fill: c.ivory, ls: 2 })}</g>`;
  // ON rail
  h += L(
    colXs[0],
    G.rail.y,
    colXs[colXs.length - 1],
    G.rail.y,
    c.brass,
    1.4,
    0.8,
  );
  if (pointCaption) {
    h += R(
      colXs[2] + G.rail.r + 6,
      G.rail.y - 16,
      colXs[3] - G.rail.r - 6,
      G.rail.y + 16,
      { fill: c.ground },
    );
    h += T("THE POINT", 1024, G.rail.y + 7, {
      f: cap,
      s: 20,
      w: 400,
      fill: c.hi,
      ls: 3,
    });
  }
  h += `<g id="puck-on">`;
  for (const x of colXs)
    h +=
      C(x, G.rail.y, G.rail.r, { fill: c.deep, stroke: c.brass, sw: 2 }) +
      C(x, G.rail.y, G.rail.r - 6, { stroke: c.brass, sw: 0.8, op: 0.7 });
  h += `</g>`;
  return `<g id="header" data-rect="20 9 2028 243">${h}</g>` + logo();
}
function numbers(list, numeralSize, cornerPay, placeSize, inset) {
  const w = (G.nums.x1 - G.nums.x0) / list.length;
  let b = "";
  list.forEach((v, i) => {
    const cx = G.nums.x0 + w * (i + 0.5),
      x0 = cx - w / 2 + 3,
      x1 = cx + w / 2 - 3;
    b += bet(
      `place-${v}`,
      `Place ${v}`,
      [x0 - 3, G.nums.y0, x1 + 3, G.nums.y1],
      frame(x0, G.nums.y0, x1, G.nums.y1, 14) +
        shade(String(v), cx, G.nums.y1 - 18, {
          f: bas,
          s: numeralSize,
          w: 600,
          fill: c.ivory,
          sh: c.ox,
        }) +
        T("PLACE", x0 + inset, G.nums.y0 + 31, {
          f: cap,
          s: placeSize,
          w: 400,
          fill: c.hi,
          ls: 1,
          a: "start",
        }) +
        T(PLACE_PAY[v], x1 - inset, G.nums.y0 + 33, {
          f: cap,
          s: cornerPay,
          w: 700,
          fill: c.hi,
          a: "end",
        }),
    );
  });
  return b;
}
function come(r) {
  const cx = (r[0] + r[2]) / 2,
    my = (r[1] + r[3]) / 2;
  return bet(
    "come",
    "Come",
    r,
    frame(r[0], r[1], r[2], r[3], 16) +
      L(r[0] + 40, my - 4, cx - 190, my - 4, c.brass, 2.6) +
      L(r[0] + 40, my + 2, cx - 190, my + 2, c.brass, 0.9) +
      L(cx + 190, my - 4, r[2] - 40, my - 4, c.brass, 2.6) +
      L(cx + 190, my + 2, r[2] - 40, my + 2, c.brass, 0.9) +
      shade("COME", cx, r[3] - 28, {
        f: cas,
        s: 84,
        w: 500,
        fill: c.ivory,
        ls: 16,
        sh: c.ox,
      }),
  );
}
function field(r, tagSize = 19) {
  const cx = (r[0] + r[2]) / 2,
    colX = (i) => r[0] + ((r[2] - r[0]) * (i + 0.5)) / 7;
  let f = frame(r[0], r[1], r[2], r[3], 16);
  f += T("FIELD", cx, r[1] + 47, { f: cas, s: 44, w: 500, fill: c.hi, ls: 12 });
  f +=
    L(r[0] + 40, r[1] + 32, cx - 122, r[1] + 32, c.brass, 1.2) +
    L(cx + 122, r[1] + 32, r[2] - 40, r[1] + 32, c.brass, 1.2);
  [2, 3, 4, 9, 10, 11, 12].forEach((v, i) => {
    const x = colX(i),
      y = 602;
    if (v === 2 || v === 12) {
      f +=
        C(x, y, 39, { fill: c.ox, stroke: c.brass, sw: 3 }) +
        C(x, y, 33, { stroke: c.hi, sw: 0.9 });
      f += T(String(v), x, y + 18, { f: bas, s: 54, w: 700, fill: c.ivory });
      f += T(v === 2 ? "PAYS 2:1" : "PAYS 3:1", x, 667, {
        f: cap,
        s: tagSize,
        w: 700,
        fill: c.hi,
        ls: tagSize < 19 ? 0 : 1,
      });
    } else
      f += T(String(v), x, y + 19, { f: bas, s: 56, w: 600, fill: c.ivory });
  });
  const stripX = (G.big[6][2] + G.big[8][0]) / 2;
  f += T("3 · 4 · 9 · 10 · 11 PAY 1:1", stripX, 685, {
    f: cap,
    s: 19,
    w: 700,
    fill: c.hi,
    ls: 1,
  });
  let b = bet("field", "Field", r, f);
  for (const v of [6, 8]) {
    const q = G.big[v];
    b += bet(
      `big-${v}`,
      `Big ${v}`,
      q,
      P(ticket(q[0], q[1], q[2], q[3] - 5, 7), {
        fill: c.ox,
        stroke: c.brass,
        sw: 1.6,
      }) +
        T(`BIG ${v}`, (q[0] + q[2]) / 2 - 22, q[3] - 14, {
          f: bas,
          s: 25,
          w: 700,
          fill: c.ivory,
          ls: 1,
        }) +
        T("1:1", q[2] - 34, q[3] - 14, { f: cap, s: 21, w: 700, fill: c.hi }),
    );
  }
  return b;
}
const docTitle = (m) => `crapsTV concept A — Heritage Engraved Emerald (${m})`;
const docDesc =
  "Original vector board. Live text, named bet groups (data-bet) and puck targets. No raster felt; surface fibre comes from the PBR normal map. Only the logo is embedded raster.";

export function build() {
  const colXs = G.nums.list.map((_, i) => G.colX(i));
  let b = header("CLASSIC CRAPS", colXs, true);
  // Lanes
  const my = (G.pass.top + G.pass.ib) / 2,
    px = (G.pass.L + G.pass.iL) / 2,
    pR = (G.pass.R + G.pass.iR) / 2;
  const passTxt = { f: cas, s: 38, w: 500, fill: c.ivory, ls: 9 };
  b += bet(
    "pass",
    "Pass Line",
    [68, 240, 1980, 836],
    P(lane(G.pass), { fill: c.deep, stroke: c.brass, sw: 2.6 }) +
      P(lane(G.pass, { inset: 5 }), { stroke: c.brass, sw: 0.9, op: 0.7 }) +
      T("PASS LINE", 1024, 821, passTxt) +
      RT("PASS LINE", px, my, 90, { ...passTxt, s: 34, ls: 10 }) +
      RT("PASS LINE", pR, my, -90, { ...passTxt, s: 34, ls: 10 }),
  );
  const dTxt = { f: cap, s: 23, w: 700, fill: c.ivory, ls: 2 };
  const dx = (G.dont.L + G.dont.iL) / 2,
    dR = (G.dont.R + G.dont.iR) / 2;
  b += bet(
    "dont",
    "Don’t Pass Bar 12",
    [145, 245, 1903, 768],
    P(lane(G.dont), { fill: "url(#a-hatch-ox)", stroke: c.brass, sw: 2.2 }) +
      T("DON’T PASS", 1014, 751, { ...dTxt, s: 21, a: "end" }) +
      pair(1046, 743, 6, 20, { face: c.ivory, pip: c.oxD }) +
      T("BAR 12", 1078, 751, { ...dTxt, s: 21, a: "start" }) +
      RT("DON’T PASS · BAR 12", dx, my, 90, dTxt) +
      RT("DON’T PASS · BAR 12", dR, my, -90, dTxt),
  );
  b += numbers(G.nums.list, 98, 27, 16, 22);
  // Don't Come
  {
    const r = G.dc,
      cx = (r[0] + r[2]) / 2;
    b += bet(
      "dontcome",
      "Don’t Come Bar 12",
      r,
      frame(r[0], r[1], r[2], r[3], 12, "url(#a-hatch-ox)") +
        T("DON’T COME", cx, r[1] + 41, {
          f: bas,
          s: 33,
          w: 700,
          fill: c.ivory,
          ls: 2,
        }) +
        pair(cx - 58, r[1] + 66, 6, 24, { face: c.ivory, pip: c.oxD }) +
        T("BAR 12", cx + 40, r[1] + 74, {
          f: cap,
          s: 23,
          w: 700,
          fill: c.hi,
          ls: 3,
        }),
    );
  }
  b += come(G.come) + field(G.field);
  // Hardways
  {
    const r = G.hw;
    b += bet(
      "hardways",
      "Hardways frame",
      r,
      frame(r[0], r[1], r[2], r[3], 12) +
        T("HARDWAYS", (r[0] + r[2]) / 2, r[1] + 29, {
          f: cap,
          s: 25,
          w: 700,
          fill: c.hi,
          ls: 4,
        }),
    );
    [4, 6, 8, 10].forEach((t, i) => {
      const q = G.hwCell(i),
        cx = (q[0] + q[2]) / 2;
      let g = L(q[0] + 10, q[1], q[2] - 10, q[1], c.brass, 0.9, 0.7);
      if (i % 2) g += L(q[0], q[1] + 6, q[0], q[3] - 8, c.brass, 0.9, 0.7);
      g += pair(cx, q[1] + 29, t / 2, 38, {
        face: c.ivory,
        pip: c.oxD,
        shade: "#000a",
      });
      g +=
        T(`HARD ${t}`, cx + 14, q[1] + 70, {
          f: cap,
          s: 15,
          w: 700,
          fill: c.ivory,
          a: "end",
        }) +
        T(PAY.hard[t], cx + 22, q[1] + 71, {
          f: cap,
          s: 18,
          w: 700,
          fill: c.hi,
          a: "start",
        });
      b += bet(`hard-${t}`, `Hard ${t}`, q, g);
    });
  }
  // One roll
  {
    const r = G.roll,
      cx = (r[0] + r[2]) / 2;
    b += `<g id="one-roll-frame" data-rect="${r.join(" ")}">${frame(r[0], r[1], r[2], r[3], 14)}${T("ONE ROLL", cx, r[1] + 37, { f: cas, s: 32, w: 500, fill: c.hi, ls: 6 })}${T("WINS OR LOSES ON THE NEXT ROLL", cx, r[3] - 13, { f: cap, s: 14, w: 700, fill: c.hi })}</g>`;
    PAY.props.forEach(([id, name, pay], i) => {
      const [y0, y1] = G.rollRows[i],
        q = [r[0], y0, r[2], y1],
        m = (y0 + y1) / 2;
      b += bet(
        id,
        name,
        q,
        L(r[0] + 14, y0, r[2] - 14, y0, c.brass, 1, 0.8) +
          T(name, r[0] + 22, m + 9, {
            f: bas,
            s: 25,
            w: 700,
            fill: c.ivory,
            ls: 1,
            a: "start",
          }) +
          T(pay, r[2] - 22, m + 10, {
            f: cap,
            s: pay.includes("EACH") ? 21 : 28,
            w: 700,
            fill: c.hi,
            a: "end",
          }),
      );
    });
  }
  return wrap(docTitle("classic"), docDesc, defs, c.ground, b);
}

export function buildCrapless() {
  const list = [2, 3, 4, 5, 6, 8, 9, 10, 11, 12];
  const w = (G.nums.x1 - G.nums.x0) / list.length;
  // No THE POINT caption: the 6 and 8 markers sit either side of centre here.
  let b = header(
    "CRAPLESS CRAPS",
    list.map((_, i) => G.nums.x0 + w * (i + 0.5)),
    false,
  );
  // Wider Pass sidebars fill the space Don't Pass uses on the classic board.
  const lanePass = {
    L: 68,
    R: 1980,
    iL: 195,
    iR: 1853,
    top: 240,
    ib: 718,
    ob: 836,
  };
  const my = (lanePass.top + lanePass.ib) / 2,
    px = (lanePass.L + lanePass.iL) / 2,
    pR = (lanePass.R + lanePass.iR) / 2;
  const passTxt = { f: cas, s: 56, w: 500, fill: c.ivory, ls: 14 };
  b += bet(
    "pass",
    "Pass Line",
    [68, 240, 1980, 836],
    P(lane(lanePass, { ri: 10 }), { fill: c.deep, stroke: c.brass, sw: 2.6 }) +
      P(lane(lanePass, { inset: 5, ri: 10 }), {
        stroke: c.brass,
        sw: 0.9,
        op: 0.7,
      }) +
      T("PASS LINE", 1024, 822, { ...passTxt, s: 42, ls: 8 }) +
      T(
        "7 WINS ON THE COME-OUT · EVERY OTHER TOTAL BECOMES A POINT",
        1024,
        754,
        { f: cap, s: 21, w: 700, fill: c.hi, ls: 2 },
      ) +
      RT("PASS LINE", px, my, 90, passTxt) +
      RT("PASS LINE", pR, my, -90, passTxt),
  );
  b += numbers(list, 84, 21, 14, 16);
  // Regions from build-boards.py crapless branch.
  const centreX0 = LX(136),
    centreX1 = LX(1576);
  b += come([centreX0, G.come[1], centreX1, G.come[3]]);
  b += field([centreX0, G.field[1], centreX1, G.field[3]], 16);
  // Hardways column, old x 1596..1746. Rows centred on the unchanged anchors.
  {
    const r = [LX(1596), G.roll[1], LX(1746), G.roll[3]],
      cx = (r[0] + r[2]) / 2;
    b += `<g id="hardways-frame" data-rect="${r.join(" ")}">${frame(r[0], r[1], r[2], r[3], 12)}${T("HARDWAYS", cx, r[1] + 33, { f: cap, s: 18, w: 700, fill: c.hi, ls: 1 })}${T("OFF ON COME-OUT", cx, r[3] - 13, { f: bas, s: 13, w: 700, fill: c.hi })}</g>`;
    [4, 6, 8, 10].forEach((t, i) => {
      const [y0, y1] = G.rollRows[i],
        m = (y0 + y1) / 2;
      b += bet(
        `hard-${t}`,
        `Hard ${t}`,
        [r[0], y0, r[2], y1],
        L(r[0] + 10, y0, r[2] - 10, y0, c.brass, 1, 0.8) +
          pair(cx, m - 8, t / 2, 26, { face: c.ivory, pip: c.oxD }) +
          T(`HARD ${t}`, cx + 12, m + 22, {
            f: cap,
            s: 14,
            w: 700,
            fill: c.ivory,
            a: "end",
          }) +
          T(PAY.hard[t], cx + 19, m + 22, {
            f: cap,
            s: 16,
            w: 700,
            fill: c.hi,
            a: "start",
          }),
      );
    });
  }
  // One Roll column, old x 1762..1912.
  {
    const r = [LX(1762), G.roll[1], LX(1912), G.roll[3]],
      cx = (r[0] + r[2]) / 2;
    b += `<g id="one-roll-frame" data-rect="${r.join(" ")}">${frame(r[0], r[1], r[2], r[3], 12)}${T("ONE ROLL", cx, r[1] + 33, { f: cap, s: 18, w: 700, fill: c.hi, ls: 1 })}${T("NEXT ROLL ONLY", cx, r[3] - 13, { f: bas, s: 14, w: 700, fill: c.hi })}</g>`;
    PAY.props.forEach(([id, name, pay], i) => {
      const [y0, y1] = G.rollRows[i],
        m = (y0 + y1) / 2;
      b += bet(
        id,
        name,
        [r[0], y0, r[2], y1],
        L(r[0] + 10, y0, r[2] - 10, y0, c.brass, 1, 0.8) +
          T(name, cx, m - 2, { f: bas, s: 18, w: 700, fill: c.ivory }) +
          T(pay, cx, m + 22, {
            f: cap,
            s: pay.includes("EACH") ? 18 : 22,
            w: 700,
            fill: c.hi,
          }),
      );
    });
  }
  return wrap(docTitle("crapless"), docDesc, defs, c.ground, b);
}
