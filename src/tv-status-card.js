import { drawStatusIcon } from "./tv-status-icons.js";
import { TV_TYPE } from "./tv-layout.js";

// Bottom status card: dark emerald field, brushed-gold rules, one emblem well.
// Logical canvas units (1100 × 160 desktop, 700 × 160 compact); the caller has
// already applied the backing-store transform.
const EMERALD_TOP = "#123228";
const EMERALD_BOTTOM = "#06140f";
const WELL_CENTER = "#16382d";
const WELL_EDGE = "#071510";
const RADIUS = 18;

function brushedGold(c, x0, x1, alpha = 1) {
  const g = c.createLinearGradient(x0, 0, x1, 0);
  const stops = [
    [0, `rgba(138,109,59,${alpha})`],
    [0.18, `rgba(227,201,143,${alpha})`],
    [0.42, `rgba(176,142,82,${alpha})`],
    [0.63, `rgba(241,220,166,${alpha})`],
    [0.84, `rgba(168,133,74,${alpha})`],
    [1, `rgba(120,94,50,${alpha})`],
  ];
  for (const [offset, color] of stops) g.addColorStop(offset, color);
  return g;
}

function cardBody(c, width, height) {
  c.beginPath();
  c.roundRect(1, 1, width - 2, height - 2, RADIUS);
  const field = c.createLinearGradient(0, 0, 0, height);
  field.addColorStop(0, EMERALD_TOP);
  field.addColorStop(1, EMERALD_BOTTOM);
  c.fillStyle = field;
  c.fill();
  // Soft light falling from the emblem side keeps the field from reading flat.
  const glow = c.createRadialGradient(
    height * 0.55,
    height * 0.35,
    0,
    height * 0.55,
    height * 0.35,
    width * 0.62,
  );
  glow.addColorStop(0, "rgba(64,120,96,.16)");
  glow.addColorStop(1, "rgba(64,120,96,0)");
  c.fillStyle = glow;
  c.fill();
  // Outer brushed-gold rule, then a fine inner hairline.
  c.lineWidth = 2;
  c.strokeStyle = brushedGold(c, 0, width);
  c.stroke();
  c.beginPath();
  c.roundRect(7.5, 7.5, width - 15, height - 15, RADIUS - 6);
  c.lineWidth = 1;
  c.strokeStyle = brushedGold(c, 0, width, 0.34);
  c.stroke();
  // Thin top sheen inside the inner rule.
  const sheen = c.createLinearGradient(0, 8, 0, 30);
  sheen.addColorStop(0, "rgba(240,229,205,.07)");
  sheen.addColorStop(1, "rgba(240,229,205,0)");
  c.fillStyle = sheen;
  c.fillRect(RADIUS, 8, width - RADIUS * 2, 22);
}

function emblem(c, icon, x, y, radius) {
  c.beginPath();
  c.arc(x, y, radius, 0, Math.PI * 2);
  const well = c.createRadialGradient(
    x - radius * 0.3,
    y - radius * 0.35,
    radius * 0.1,
    x,
    y,
    radius,
  );
  well.addColorStop(0, WELL_CENTER);
  well.addColorStop(1, WELL_EDGE);
  c.fillStyle = well;
  c.fill();
  c.lineWidth = 2;
  c.strokeStyle = brushedGold(c, x - radius, x + radius);
  c.stroke();
  c.beginPath();
  c.arc(x, y, radius - 6, 0, Math.PI * 2);
  c.lineWidth = 1;
  c.strokeStyle = brushedGold(c, x - radius, x + radius, 0.32);
  c.stroke();
  drawStatusIcon(c, icon, x, y, radius * 1.08);
}

function divider(c, x, top, bottom) {
  const g = c.createLinearGradient(0, top, 0, bottom);
  g.addColorStop(0, "rgba(199,171,115,0)");
  g.addColorStop(0.5, "rgba(199,171,115,.42)");
  g.addColorStop(1, "rgba(199,171,115,0)");
  c.fillStyle = g;
  c.fillRect(x, top, 1, bottom - top);
}

export function drawStatusCard(
  c,
  { width, height, icon, heading, detail, headingColor, detailColor },
  fittedText,
) {
  c.save();
  try {
    // Compact keeps 560 px of text: the longest fixed copy, "Your recaps are
    // on your phones", needs 542 px at fittedText's 36 px floor.
    const compact = width < 900;
    const radius = compact ? 38 : 52;
    const emblemX = (compact ? 18 : 28) + radius;
    const emblemY = height / 2;
    cardBody(c, width, height);
    emblem(c, icon, emblemX, emblemY, radius);
    const dividerX = emblemX + radius + (compact ? 12 : 22);
    divider(c, dividerX, 30, height - 30);

    const textX = dividerX + (compact ? 14 : 26);
    const maxWidth = width - textX - (compact ? 20 : 34);
    const headingText = String(heading ?? "");
    const detailText = String(detail ?? "");
    c.textAlign = "left";
    c.textBaseline = "alphabetic";
    if (detailText) {
      fittedText(
        c,
        headingText,
        textX,
        72,
        TV_TYPE.result,
        maxWidth,
        headingColor,
        700,
      );
      fittedText(
        c,
        detailText,
        textX,
        122,
        TV_TYPE.status,
        maxWidth,
        detailColor,
        600,
      );
    } else {
      // Centre the measured glyph box, not the em box, so short or descending
      // headings sit optically on the emblem's axis.
      c.font = `700 ${TV_TYPE.result}px Manrope,Arial,sans-serif`;
      const m = c.measureText(headingText);
      const ascent = m.actualBoundingBoxAscent || TV_TYPE.result * 0.72;
      const descent = m.actualBoundingBoxDescent || 0;
      const baseline = Math.round(height / 2 + (ascent - descent) / 2);
      fittedText(
        c,
        headingText,
        textX,
        baseline,
        TV_TYPE.result,
        maxWidth,
        headingColor,
        700,
      );
    }
  } finally {
    c.restore();
  }
}
