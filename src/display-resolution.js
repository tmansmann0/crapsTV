export const TV_PIXEL_BUDGET = 3840 * 2160;
const positive = (value, fallback) =>
  Number.isFinite(value) && value > 0 ? value : fallback;

/** Pixel density follows actual display pixels, with a 4K automatic ceiling. */
export function automaticRenderScale(capabilities = {}) {
  const dpr = positive(capabilities.devicePixelRatio, 1);
  const lowMemory = positive(capabilities.deviceMemory, Infinity) <= 4;
  const software = capabilities.software === true;
  const width = positive(capabilities.viewportWidth, 0);
  const height = positive(capabilities.viewportHeight, 0);
  const densityCap = software ? 0.7 : lowMemory ? 1 : Infinity;
  if (!width || !height)
    return Math.min(1, (Number.isFinite(densityCap) ? densityCap : 1.5) / dpr);
  const budget = software
    ? 1280 * 720
    : lowMemory
      ? 1920 * 1080
      : TV_PIXEL_BUDGET;
  return Math.min(
    1,
    densityCap / dpr,
    Math.sqrt(budget / (width * height * dpr ** 2)),
  );
}

/** Keep UI sharp independently of 3D render scale; never allocate beyond GPU limits. */
export function planDisplayBuffers({
  width,
  height,
  devicePixelRatio = 1,
  scenePixelRatio = 1,
  maxEdge = 8192,
  splitSupported = true,
}) {
  width = Math.max(1, Math.floor(positive(width, 1)));
  height = Math.max(1, Math.floor(positive(height, 1)));
  const edgeRatio = positive(maxEdge, 8192) / Math.max(width, height);
  const sceneRatio = Math.min(positive(scenePixelRatio, 1), edgeRatio);
  const nativeUIRatio = Math.min(
    positive(devicePixelRatio, 1),
    Math.sqrt(TV_PIXEL_BUDGET / (width * height)),
    edgeRatio,
  );
  const uiRatio = splitSupported ? nativeUIRatio : sceneRatio;
  const dimensions = (ratio) => [
    Math.max(1, Math.floor(width * ratio)),
    Math.max(1, Math.floor(height * ratio)),
  ];
  const [uiWidth, uiHeight] = dimensions(uiRatio);
  const [sceneWidth, sceneHeight] = dimensions(sceneRatio);
  return {
    width,
    height,
    uiRatio,
    sceneRatio,
    uiWidth,
    uiHeight,
    sceneWidth,
    sceneHeight,
    split: uiWidth !== sceneWidth || uiHeight !== sceneHeight,
  };
}
