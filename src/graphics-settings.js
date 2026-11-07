/** Shared wire values; all automatic decisions remain device-local. */
export const DEFAULT_GRAPHICS = Object.freeze({
  fps: "auto",
  antialias: "auto",
  resolution: "auto",
  modelDetail: "auto",
  textures: "auto",
});

const choice = (value, label) => Object.freeze({ value, label });
export const GRAPHICS_OPTIONS = Object.freeze({
  fps: Object.freeze([
    choice("auto", "Auto"),
    choice(24, "24 FPS"),
    choice(30, "30 FPS"),
    choice(60, "60 FPS"),
  ]),
  antialias: Object.freeze([
    choice("auto", "Auto"),
    choice("on", "On"),
    choice("off", "Off"),
  ]),
  resolution: Object.freeze([
    choice("auto", "Auto"),
    choice("75", "75%"),
    choice("100", "100% (native)"),
    choice("150", "150%"),
    choice("200", "200%"),
  ]),
  modelDetail: Object.freeze([
    choice("auto", "Auto"),
    choice("full", "Full"),
    choice("optimized", "Optimized"),
  ]),
  textures: Object.freeze([
    choice("auto", "Auto"),
    choice("1k", "1K"),
    choice("2k", "2K"),
    choice("4k", "4K"),
    choice("native", "Native"),
  ]),
});

function validatedPatch(input) {
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(input))
  )
    throw new Error("Invalid graphics settings.");
  const patch = {};
  for (const key of Reflect.ownKeys(input)) {
    if (typeof key !== "string" || !Object.hasOwn(GRAPHICS_OPTIONS, key))
      throw new Error("Unknown graphics setting.");
    if (!GRAPHICS_OPTIONS[key].some((option) => option.value === input[key]))
      throw new Error(`Invalid graphics option for ${key}.`);
    patch[key] = input[key];
  }
  return patch;
}

/** Validate a stored/partial configuration and fill missing fields with Auto. */
export function normalizeGraphics(input = {}) {
  return { ...DEFAULT_GRAPHICS, ...validatedPatch(input) };
}

/** Validate before merging, so an invalid patch cannot alter existing settings. */
export function mergeGraphics(current, patch) {
  return { ...normalizeGraphics(current), ...validatedPatch(patch) };
}
