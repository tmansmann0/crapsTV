# Detailed casino chips

`public/assets/chip.glb` is an original, modeled casino chip, not a plain cylinder. It has a lathed and beveled clay rim, eight aligned cream edge inserts, recessed front/back medallions, a real Boolean-engraved `crapsTV` wordmark, recessed pip marks, and fine brass rings. The GLB embeds its base color, first wear normal map, and packed roughness texture.

## Files

- `public/assets/chip.glb`: runtime glTF 2.0 model, 1,227,432 bytes including embedded textures.
- `public/assets/chip-color.png`: neutral 512 × 512 clay/printed-ring albedo.
- `public/assets/chip-wear-1.png` through `chip-wear-3.png`: three different 512 × 512 grayscale bump/height patterns.
- `public/assets/chip-normal-1.png` through `chip-normal-3.png`: matching tangent-space normal maps.
- `public/assets/chip-roughness-1.png` through `chip-roughness-3.png`: matching surface roughness maps.
- `public/assets/chip-preview.png`: Blender Cycles product preview showing runtime-style body tints.
- `assets/source/chip.blend`: editable Blender source with image maps packed inside.
- `scripts/build-chips.py`: deterministic original modeling and map-generation source.

Each wear variant has a distinct seeded distribution of micrograin, circular manufacturing traces, scratches, and edge scuffs. The side strip's procedural wear is periodic across its U seam. These are real texture files intended for normal/bump mapping; no photo or external texture was used.

## Size and axes

The chip is **1 unit in diameter and 0.13 units thick**, centered at the origin. Exported glTF uses **+Y for the top face**, with width/depth in X/Z. The Blender source uses +Z up. Scale uniformly to the desired game diameter; for example, a 0.22-unit chip uses `scale.setScalar(0.22)` and has a stacked height of 0.0286 units before a small visual gap.

The source has 5,398 vertices and 10,098 triangles before glTF export's UV/normal splits. It is consolidated into one mesh with four material primitives. The detailed mesh is suitable for nearby chips; use shared geometry/materials or instancing for large chip counts rather than duplicating GPU buffers.

## Material tint and wear variation

| Material name | Intended behavior |
| --- | --- |
| `ChipBase` | Neutral clay base; tint `material.color` to a denomination color. Keep its embedded albedo map. |
| `ChipInlay` | Fixed warm cream edge inserts; leave its color unchanged. |
| `ChipMetal` | Fine brass ring; leave its metallic/roughness behavior unchanged. |
| `ChipEngraving` | Dark recessed wordmark floor; leave fixed for legibility. |

Clone a material before tinting so one chip denomination does not recolor other chips that share the same material. Apply a chosen wear normal and roughness pair to `ChipBase` and `ChipInlay`. Three.js texture loads of these external files should use `flipY = false` to match the glTF UV orientation, and `NoColorSpace` (linear data) for normal, roughness, and height maps. The albedo file uses sRGB.

The model already includes normal variant 1. For variant 2 or 3, replace `normalMap` and `roughnessMap` with the corresponding pair. Normal strength about `normalScale.set(0.7, 0.7)` preserves subtle scuffs. An optional `bumpMap` can use the matching `chip-wear-N.png` at a small `bumpScale` (about 0.002 before any stylistic adjustment); a normal map alone is sufficient and avoids exaggerating wear.

## UV atlas

The front disc occupies a circle centered at U=0.25, V=0.37 with radius 0.225. The back disc is centered at U=0.75, V=0.37 with the same radius. The cylindrical side wraps once across U=0..1 in V=0.80..0.98. Top and side edge inlays are actual material regions rather than disconnected decals.

## Rebuild and provenance

```sh
blender --background --python scripts/build-chips.py
```

Built and previewed with Blender 4.5 LTS. All geometry, map generation, and textures were authored for crapsTV and follow the repository's asset license. No image generation, stock assets, or external references were used for this model.

Validation: the final Cycles preview was visually inspected; front-cap smoothing was corrected so the engraved cuts remain planar. The GLB structure confirms one mesh, four primitives, embedded PNG material textures, and Y-up bounds of ±0.5 across X/Z and ±0.065 across Y. The three height-map files have distinct hashes and preserve the same UV atlas dimensions.

## Phone tray thumbnails

The five `chip-100.png` through `chip-50000.png` files are transparent, pre-rendered views of this same GLB. They avoid allocating an extra WebGL context on each phone just to draw the 2D tray. Rebuild them after changing the chip model with:

```sh
node scripts/render-chip-thumbnails.mjs
```

The generator uses the shared runtime chip material factory and a temporary local Vite server. It requires the development dependencies and Playwright Chromium.
