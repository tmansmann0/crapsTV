# Logo-engraved casino chips

The active models are `public/assets/chip-logo.glb` and `chip-logo-lod.glb`. They retain the beveled clay rim, eight cream edge inserts, recessed medallions and fine brass rings. Both faces now carry the **actual `brand-logo.png` artwork**: its dice, original wordmark, TV counter-shapes and decorative frame. The monochrome stamp derives from the source alpha and gold/ivory luminance; no substitute font, generic dice pits, new generated image or redrawn lettering is used.

The original `chip.glb`, `chip-lod.glb`, `assets/source/chip.blend` and `chip-lod.blend` remain byte-for-byte unchanged. The new variants have their own editable, texture-packed `.blend` sources. SHA-256 preservation records are in `public/assets/chip-logo-stats.json`.

| Active model | Triangles | Material batches | GLB bytes |
| --- | ---: | ---: | ---: |
| `chip-logo.glb` | 8,440 | 4 | 273,000 |
| `chip-logo-lod.glb` | 1,280 | 4 | 46,264 |
| Previous detailed / LOD | 10,098 / 1,984 | 4 / 4 | Original files preserved |

Shared textures remain external PNGs, referenced by content-hashed URLs, so the two model files do not embed duplicate maps. Both detail levels use the same engraving atlas. The runtime factory shares the detailed model's materials with the LOD geometry, retaining the existing instancing and projected-size hysteresis.

## Engraving and materials

The actual mark is cut **0.0032 scene units below the clay surface** in a height bake, with a rounded bevel and matched OpenGL normal/roughness maps. This is shallow surface relief; no thousands of boolean letters or fake freestanding pip geometry are required. The medallion itself remains physically recessed inside the modeled rim. Engraving relief uses the shared `ChipEngraving` material, while `ChipBase` retains denomination tint and three worn variations. `ChipInlay` remains cream and `ChipMetal` remains the brass groove ring. The common warm clay medallion keeps the mark legible across denominations.

New maps are `chip-logo-albedo.png`, `chip-logo-normal.png`, `chip-logo-roughness.png` and `chip-logo-height.png`, each 1,024 × 1,024. `chip-logo-mark.png` is the transparent monochrome source-derived mark, and `chip-logo-atlas.json` records its exact source hash, crop, transformation, depth and atlas coordinates. The original neutral clay and three seeded wear sets remain untouched.

## Size and face orientation

Both models are one unit in diameter and 0.13 units thick, centered at the origin. Exported glTF uses +Y for the top face and X/Z for the horizontal plane. The Blender sources use +Z up. The detailed rim has 96 radial segments; the LOD uses 32 while preserving the same physical bounds.

The original atlas layout remains: Blender UV front center `(0.25, 0.37)`, back center `(0.75, 0.37)`, disc radius `0.225`, side strip V `0.80..0.98`. PNG/glTF V centers are `0.63`. The back's local Y projection is reflected before export, so both logo faces read normally when the chip flips about X. This reflection corrects handedness rather than mirroring the wordmark in the texture. Normal/roughness maps use linear data; albedo uses sRGB; runtime textures retain glTF's `flipY=false` convention.

## Rebuild and proof

```sh
python scripts/bake-chip-logo.py
blender --background --python scripts/build-logo-chips.py
node scripts/render-chip-logo.mjs after
node scripts/render-chip-thumbnails.mjs
```

The bake requires NumPy/Pillow; geometry generation uses Blender 4.5 LTS. Shared-image GLB packaging is in `scripts/glb_shared_images.py`. Exports publish through complete temporary sibling files. The isolated Three.js proof harness uses the actual runtime factory, casino EXR and an ephemeral port with HMR disabled; it does not touch live rooms.

`docs/screenshots/chip-logo-faces.png` shows detailed chips on the left and optimized chips on the right; top row is front, bottom row is back after flipping. `chip-logo-raking.png` shows the engraved bevel under low light. The identical view with only its normal disabled is saved as `artifacts/chip-logo-after-raking-flat.png`, proving the depth is present beyond the albedo mask. Matched old/new captures and error/draw statistics are in `artifacts/chip-logo-{before,after}*`.

Focused tests verify the exact source-pixel transformation, negative height, normal slopes, both UV orientations, dimensions, shared materials, content hashes, protected original hashes and geometry budgets. Phone tray PNGs `chip-100.png` through `chip-50000.png` are regenerated from this active runtime model without allocating permanent extra WebGL contexts on phones.
