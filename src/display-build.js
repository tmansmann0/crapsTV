import { GRAPHICS_OPTIONS, normalizeGraphics } from "./graphics-settings.js";
import { RESOLUTION_PRESETS } from "./display-resolution.js";

export const DESKTOP_DISPLAY = import.meta.env.MODE === "desktop";
export const DISPLAY_GRAPHICS_OPTIONS = DESKTOP_DISPLAY
  ? GRAPHICS_OPTIONS
  : {
      ...GRAPHICS_OPTIONS,
      resolution: GRAPHICS_OPTIONS.resolution.filter(
        ({ value }) => !Object.hasOwn(RESOLUTION_PRESETS, value),
      ),
    };

export function graphicsForDisplay(input) {
  const graphics = normalizeGraphics(input);
  if (!DESKTOP_DISPLAY) {
    if (Object.hasOwn(RESOLUTION_PRESETS, graphics.resolution))
      graphics.resolution = "auto";
    graphics.upscaling = "off";
  }
  return graphics;
}
