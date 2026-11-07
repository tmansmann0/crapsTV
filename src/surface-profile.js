import {
  MATERIAL_LOOKS,
  createMaterialLookController,
} from "./material-look.js";
import { createChipScratchPreview } from "./chip-scratch-preview.js";

/** User-selected option 2: C felt, B padding/grime, clear scored clay, American wood. */
export const SELECTED_SURFACE_PROFILE = "refined";
const applied = new WeakMap();
const rootFor = (material) => ({
  traverse(visitor) {
    visitor({ material });
  },
});

/**
 * Apply once when a shared material is created. The WeakMap keeps the authored
 * baseline, so repeated setup never compounds normal strengths or shader hooks.
 * Geometry, denomination/wear cache keys and instancing buckets stay unchanged.
 * Wood's matched maps/finish are selected separately by the table material loader.
 */
export function applySurfaceProfile(
  material,
  kind,
  { scratchTexture, profile = SELECTED_SURFACE_PROFILE } = {},
) {
  if (!MATERIAL_LOOKS[profile])
    throw new Error(`Unknown surface profile: ${profile}`);
  if (!MATERIAL_LOOKS[profile][kind])
    throw new Error(`Unknown surface kind: ${kind}`);
  if (kind === "chip" && !scratchTexture?.isTexture)
    throw new Error("Selected chip surfaces require the shared scratch atlas");
  let record = applied.get(material);
  if (!record) {
    material.userData.materialLookKind = kind;
    const root = rootFor(material);
    const look = createMaterialLookController(root);
    const scratches =
      kind === "chip" ? createChipScratchPreview(root, scratchTexture) : null;
    if (scratchTexture) material.scratchMap = scratchTexture;
    record = { kind, look, scratches, texture: scratchTexture };
    applied.set(material, record);
  } else if (record.kind !== kind || record.texture !== scratchTexture) {
    throw new Error(
      "A shared surface cannot change its material kind or scratch atlas",
    );
  }
  record.look.apply(profile);
  record.scratches?.apply(MATERIAL_LOOKS[profile].chip.scratch);
  material.userData.surfaceProfile = profile;
  return material;
}
