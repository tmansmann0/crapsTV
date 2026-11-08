import { normalizeGraphics } from "./graphics-settings.js";
import { automaticRenderScale } from "./display-resolution.js";

const positive = (value, fallback) =>
  typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : fallback;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const nativeDpr = (capabilities) => positive(capabilities?.devicePixelRatio, 1);
const hardwareTextureLimit = (capabilities) =>
  Math.floor(positive(capabilities?.maxTextureSize, 8192));

/** Capability-only starting point; no user-agent, vendor or device-name guesses. */
export function recommendGraphics(capabilities = {}) {
  const memory = positive(capabilities?.deviceMemory, Infinity);
  const threads = positive(capabilities?.hardwareConcurrency, Infinity);
  const software = capabilities?.software === true;
  const lowMemory = memory <= 4;
  const reduced = software || lowMemory || threads <= 2;
  const physicalPixels =
    (capabilities.viewportWidth || 0) *
    (capabilities.viewportHeight || 0) *
    nativeDpr(capabilities) ** 2;
  return {
    fps: software ? 24 : 60,
    resolutionScale: automaticRenderScale(capabilities),
    antialias: !software && !lowMemory,
    modelDetail: reduced ? "optimized" : "auto",
    textureLimit:
      reduced || hardwareTextureLimit(capabilities) < 2048
        ? 1024
        : physicalPixels >= 3840 * 2160 &&
            hardwareTextureLimit(capabilities) >= 4096
          ? 4096
          : 2048,
  };
}

function safeProfile(profile, capabilities = {}) {
  const fallback = recommendGraphics(capabilities);
  if (!profile || typeof profile !== "object") return fallback;
  return {
    fps: [24, 30, 60].includes(profile.fps) ? profile.fps : fallback.fps,
    resolutionScale: Math.min(
      1,
      positive(profile.resolutionScale, fallback.resolutionScale),
    ),
    antialias:
      typeof profile.antialias === "boolean"
        ? profile.antialias
        : fallback.antialias,
    modelDetail: ["auto", "optimized"].includes(profile.modelDetail)
      ? profile.modelDetail
      : fallback.modelDetail,
    textureLimit: [1024, 2048, 4096].includes(profile.textureLimit)
      ? profile.textureLimit
      : fallback.textureLimit,
  };
}

/**
 * Use raw frame intervals from the short diagnostic, before an FPS limiter.
 * P80 ignores occasional slow frames; hidden-tab gaps and invalid samples are
 * excluded. Sparse measurements keep the capability-based recommendation.
 */
export function calibrateGraphics(profile, frameIntervalsMs) {
  const current = safeProfile(profile);
  const samples =
    Array.isArray(frameIntervalsMs) || ArrayBuffer.isView(frameIntervalsMs)
      ? Array.from(frameIntervalsMs).filter(
          (value) =>
            typeof value === "number" &&
            Number.isFinite(value) &&
            value >= 1 &&
            value <= 250,
        )
      : [];
  if (samples.length < 8) return current;
  samples.sort((a, b) => a - b);
  const p80 = samples[Math.ceil(samples.length * 0.8) - 1];
  const fps = p80 <= 19 ? 60 : p80 <= 38 ? 30 : 24;
  const resolutionScale =
    p80 > 20
      ? Math.min(
          current.resolutionScale,
          clamp(current.resolutionScale * 0.8, 0.35, 1),
        )
      : current.resolutionScale;
  // AA affects context creation, so calibration must never toggle it.
  return { ...current, fps, resolutionScale };
}

/** Resolve per-setting user overrides without changing the auto profile. */
export function resolveGraphics(requested, profile, capabilities = {}) {
  const settings = normalizeGraphics(requested);
  const auto = safeProfile(profile, capabilities);
  const resolutionScale =
    settings.resolution === "auto"
      ? Math.min(auto.resolutionScale, automaticRenderScale(capabilities))
      : Number(settings.resolution) / 100;
  const wantedTexture =
    settings.textures === "auto"
      ? auto.textureLimit
      : settings.textures === "native"
        ? Infinity
        : settings.textures === "1k"
          ? 1024
          : settings.textures === "4k"
            ? 4096
            : 2048;
  return {
    fps: settings.fps === "auto" ? auto.fps : settings.fps,
    pixelRatio: nativeDpr(capabilities) * resolutionScale,
    resolutionScale,
    antialias:
      settings.antialias === "auto"
        ? auto.antialias
        : settings.antialias === "on",
    modelDetail:
      settings.modelDetail === "auto" ? auto.modelDetail : settings.modelDetail,
    textureLimit: Math.min(wantedTexture, hardwareTextureLimit(capabilities)),
    lensFlares: settings.lensFlares === "on",
    localReflections: settings.localReflections === "on",
    contactShadows: settings.contactShadows === "on",
  };
}
