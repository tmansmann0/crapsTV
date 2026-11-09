/** The measured Auto base profile is local to a display, never part of a room. */
export const GRAPHICS_CALIBRATION_STORAGE = "crapstv-graphics-calibration-v1";
const VERSION = 1;
const number = (value, fallback = 0) =>
  typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : fallback;
function profileValue(profile) {
  if (
    !profile ||
    typeof profile !== "object" ||
    Array.isArray(profile) ||
    ![24, 30, 60].includes(profile.fps) ||
    typeof profile.antialias !== "boolean" ||
    !["auto", "optimized"].includes(profile.modelDetail) ||
    ![1024, 2048, 4096].includes(profile.textureLimit) ||
    !Number.isFinite(profile.resolutionScale) ||
    profile.resolutionScale < 0.1 ||
    profile.resolutionScale > 1
  )
    return null;
  return {
    fps: profile.fps,
    resolutionScale: profile.resolutionScale,
    antialias: profile.antialias,
    modelDetail: profile.modelDetail,
    textureLimit: profile.textureLimit,
  };
}
function deviceValue(capabilities = {}, rendererName) {
  const name =
    typeof rendererName === "string" ? rendererName.trim().slice(0, 512) : "";
  return {
    renderer: name && name !== "WebGL device" ? name : null,
    software: capabilities.software === true,
    maxTextureSize: number(capabilities.maxTextureSize, 8192),
    physicalPixels:
      number(capabilities.viewportWidth) *
      number(capabilities.viewportHeight) *
      number(capabilities.devicePixelRatio, 1) ** 2,
    deviceMemory: number(capabilities.deviceMemory),
    hardwareConcurrency: number(capabilities.hardwareConcurrency),
  };
}
function compatible(record, current) {
  const old = record.device;
  if (
    !old ||
    typeof old !== "object" ||
    typeof old.software !== "boolean" ||
    !Number.isFinite(old.maxTextureSize) ||
    old.maxTextureSize <= 0 ||
    !Number.isFinite(old.physicalPixels) ||
    old.physicalPixels < 0
  )
    return false;
  if (
    old.software !== current.software ||
    (old.renderer && current.renderer && old.renderer !== current.renderer)
  )
    return false;
  if (
    current.maxTextureSize <
    Math.min(old.maxTextureSize, record.profile.textureLimit)
  )
    return false;
  // Ordinary resizing and smaller displays retain the known stable settings.
  // A >50% pixel workload increase is a materially different rendering target.
  if (
    old.physicalPixels > 0 &&
    current.physicalPixels > old.physicalPixels * 1.5
  )
    return false;
  if (
    current.deviceMemory > 0 &&
    current.deviceMemory <= 4 &&
    old.deviceMemory > 4 &&
    (record.profile.textureLimit > 1024 || record.profile.antialias)
  )
    return false;
  if (
    current.hardwareConcurrency > 0 &&
    current.hardwareConcurrency <= 2 &&
    old.hardwareConcurrency > 2
  )
    return false;
  return true;
}
export function readGraphicsCalibration({
  storage,
  capabilities,
  rendererName,
} = {}) {
  try {
    const source =
      storage ?? (typeof window === "undefined" ? null : window.localStorage);
    const record = JSON.parse(
      source.getItem(GRAPHICS_CALIBRATION_STORAGE) || "null",
    );
    const profile = profileValue(record?.profile);
    if (!profile || record.version !== VERSION) return null;
    const checked = { ...record, profile };
    if (!compatible(checked, deviceValue(capabilities, rendererName)))
      return null;
    return { profile: { ...profile }, savedAt: record.savedAt ?? null };
  } catch {
    return null;
  }
}
/** Save only after a complete calibration; preferences remain in their own key. */
export function writeGraphicsCalibration(
  profile,
  { storage, capabilities, rendererName, now = Date.now() } = {},
) {
  try {
    const checked = profileValue(profile);
    if (!checked) return false;
    const source =
      storage ?? (typeof window === "undefined" ? null : window.localStorage);
    source.setItem(
      GRAPHICS_CALIBRATION_STORAGE,
      JSON.stringify({
        version: VERSION,
        profile: checked,
        device: deviceValue(capabilities, rendererName),
        savedAt: Number.isFinite(now) ? now : null,
      }),
    );
    return true;
  } catch {
    return false;
  }
}
