// Logical typography at a 1920 × 1080 TV viewport. Scale with frame height,
// not fixed CSS pixels, so a 4K display retains the same relative text size.
export const TV_TYPE = Object.freeze({
  code: 78,
  result: 54,
  status: 38,
  setting: 36,
  label: 36,
});
export const TV_UI_STORAGE_KEY = "crapstv-tv-ui-size-v1";
export const TV_UI_SCALES = Object.freeze({ compact: 0.67, large: 1 });
export const TV_LABEL_STORAGE_KEY = "crapstv-tv-labels-v1";
export const TV_LABEL_MOTIONS = Object.freeze(["smooth", "stable", "hidden"]);
export const JOIN_CARD = Object.freeze({
  addressX: 26,
  addressWidth: 374,
  addressBaselines: [148, 183],
  qr: { x: 434, y: 27, size: 136 },
});

// Keep host + port together whenever possible. The separately displayed room
// code makes query/hash tokens redundant; the QR still uses the original URL.
export function fitJoinAddress(value, measure) {
  let address = String(value || "Connecting…"),
    hostLength = address.length;
  try {
    const url = new URL(address);
    address = `${url.host}${url.pathname === "/" ? "" : url.pathname}`;
    hostLength = url.host.length;
  } catch {
    /* Connection status is also rendered in this space. */
  }
  const width = JOIN_CARD.addressWidth;
  for (let size = 36; size >= 24; size--) {
    if (measure(address, size) <= width)
      return { address, lines: [address], size };
    if (measure(address.slice(0, hostLength), size) > width) continue;
    const candidates = [];
    for (let i = hostLength; i < address.length; i++) {
      if (i && /[/?&#=._-]/.test(address[i])) candidates.push(i);
    }
    // Prefer a complete host line, then a later URL component boundary.
    for (const i of candidates) {
      const lines = [address.slice(0, i), address.slice(i)];
      if (lines.every((line) => measure(line, size) <= width))
        return { address, lines, size };
    }
  }
  // Unusually long components still display completely, never with ellipsis.
  // Split at the most balanced measured boundary and fit both lines together.
  let best = null;
  for (let i = 1; i < address.length; i++) {
    const lines = [address.slice(0, i), address.slice(i)];
    const widest = Math.max(...lines.map((line) => measure(line, 24)));
    if (!best || widest < best.widest) best = { lines, widest };
  }
  return best
    ? {
        address,
        lines: best.lines,
        size: Math.min(24, (24 * width) / best.widest),
      }
    : { address, lines: [address], size: 24 };
}
export function normalizeLabelMotion(value) {
  return TV_LABEL_MOTIONS.includes(value) ? value : "smooth";
}
const PANEL_SIZES = {
  brand: [256, 96],
  settingsButton: [88, 88],
  settings: [540, 722],
  graphics: [640, 710],
  join: [600, 210],
  status: [1100, 160],
  intro: [760, 310],
};

export function createTVLayout(
  width,
  height,
  {
    pixelRatio = 1,
    maxTextureSize = 4096,
    uiSize = "compact",
    labelMotion = "smooth",
  } = {},
) {
  width = Math.max(1, Number.isFinite(width) ? width : 1920);
  height = Math.max(1, Number.isFinite(height) ? height : 1080);
  pixelRatio = Math.max(1, Number.isFinite(pixelRatio) ? pixelRatio : 1);
  maxTextureSize = Math.max(
    1,
    Number.isFinite(maxTextureSize) ? maxTextureSize : 4096,
  );
  const compact = width / height < 1.2 || width < 650;
  uiSize = Object.hasOwn(TV_UI_SCALES, uiSize) ? uiSize : "compact";
  const uiScale = TV_UI_SCALES[uiSize];
  const frameScale = compact
    ? Math.min(width / 760, height / 1120)
    : height / 1080;
  const scale = frameScale * uiScale;
  // TV safe area follows the 1080p 80 × 60 reference. Phones are a fallback.
  const marginX = compact ? 16 : 80 * frameScale;
  const marginY = compact ? 16 : 60 * frameScale;
  const panels = {};
  function place(
    id,
    x,
    y,
    localScale = scale,
    logicalWidth = PANEL_SIZES[id][0],
  ) {
    const logicalHeight = PANEL_SIZES[id][1];
    const density = Math.min(
      localScale * pixelRatio,
      maxTextureSize / logicalWidth,
      maxTextureSize / logicalHeight,
    );
    panels[id] = {
      x,
      y,
      width: logicalWidth * localScale,
      height: logicalHeight * localScale,
      scale: localScale,
      logicalWidth,
      logicalHeight,
      backingScale: density,
      backingWidth: Math.max(1, Math.ceil(logicalWidth * density)),
      backingHeight: Math.max(1, Math.ceil(logicalHeight * density)),
    };
  }
  place("settingsButton", marginX, marginY);
  place("brand", marginX + 108 * scale, marginY);
  place(
    "join",
    width - marginX - 600 * scale,
    compact ? marginY + 110 * scale : marginY,
  );
  place(
    "settings",
    marginX,
    marginY + 110 * scale,
    Math.min(
      scale,
      (width - marginX * 2) / 540,
      (height - marginY * 2 - 110 * scale) / 722,
    ),
  );
  place(
    "graphics",
    marginX,
    marginY + 110 * scale,
    Math.min(
      scale,
      (width - marginX * 2) / 640,
      (height - marginY * 2 - 110 * scale) / 710,
    ),
  );
  const statusWidth = compact ? 700 : 1100;
  const statusScale = Math.min(scale, (width - marginX * 2) / statusWidth);
  place(
    "status",
    (width - statusWidth * statusScale) / 2,
    height - marginY - 160 * statusScale,
    statusScale,
    statusWidth,
  );
  const introScale = Math.min(scale, (width - marginX * 2) / 760);
  place(
    "intro",
    (width - 760 * introScale) / 2,
    (height - 310 * introScale) / 2,
    introScale,
  );
  return {
    width,
    height,
    compact,
    uiSize,
    uiScale,
    labelScale: uiScale,
    labelMotion: normalizeLabelMotion(labelMotion),
    scale,
    safeArea: { x: marginX, y: marginY },
    panels,
    type: TV_TYPE,
  };
}
