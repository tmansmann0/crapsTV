# Original table, dice, and lighting assets

These assets were authored for crapsTV, without downloaded third-party meshes or board artwork. They follow the repository's license. The editable sources and deterministic build scripts are included.

| File | Purpose |
| --- | --- |
| `public/assets/table.glb` | Sculpted oxblood upholstery, substantial grained walnut apron, fine brass inlay, recessed pine baize, four cutout cup wells, dealer chip rack, and broad end pedestals |
| `public/assets/table-*.png` | Authored walnut grain, leather color and leather normal-map textures, embedded into the table GLB |
| `public/assets/dice.glb` | One ruby casino die with ivory pip inlays and softly beveled edges |
| `public/assets/board-classic.svg` | Editable vector classic craps layout |
| `public/assets/board-crapless.svg` | Editable vector crapless layout, including 2, 3, 11, and 12 place boxes |
| `public/assets/board-*.png` | 2048×1024 raster exports of the SVG layouts for texture-loader fallback |
| `public/assets/casino-studio.hdr` | Genuine scene-linear RGBE environment, 1024×512, for image-based illumination |
| `public/assets/table-preview.png`, `dice-preview.png` | Blender Cycles QA renders, with transparent backgrounds |
| `assets/source/table.blend`, `dice.blend` | Editable Blender 4.5 LTS scene files |

## Three.js integration

Both GLBs use the glTF Y-up convention. The table is centered on the origin, 12 units wide along X and 6.7 units deep along Z. The felt surface is at Y=0. The upholstered rail crown is Y=0.32; the pedestals extend to approximately Y=-2.5. The SVG or PNG board can be put on a `PlaneGeometry(10.84, 5.40)` with `rotation.x = -Math.PI / 2`, positioned at Y=0.012. Do not bake the classic texture into the shared table model: swap the board plane texture for crapless mode.

The revised layout reserves the bottom 22–24% of the felt for odds and player chips. All printed Y coordinates from the original board are multiplied by 0.82, with independently resized, undistorted typography. The last pass-line boundary is at pixel Y=779; the rest remains empty except for the outer hairline frame. To map artwork pixels to table coordinates, use `X=(px/2048-0.5)*10.84` and `Z=(py/1024-0.5)*5.40`. The classic pass-line center is approximately `(px=1024, py=754)`, or world `(X=0, Z=1.28)`; an odds row at `py=890` maps to `Z=1.99`. Spread chip positions horizontally away from the centered pass label.

The die is one unit across, with origin at its center. Face values are:

| Direction | Face |
| --- | --- |
| +Y | 1 |
| -Y | 6 |
| +Z | 2 |
| -Z | 5 |
| +X | 3 |
| -X | 4 |

Choose a final quaternion that rotates the chosen face's normal to world +Y. Animation should settle at that orientation; the dice mesh does not decide game outcomes.

The current scene uses `EXRLoader` with `casino-room.exr` for both background and PMREM environment (see [environment.md](environment.md)). The earlier `casino-studio.hdr` is retained as a fallback and can be loaded with `HDRLoader` and `EquirectangularReflectionMapping`. This file contains actual scene-linear values from approximately 0.0398 to 17.875, with warm wall-light lobes and overhead softboxes. It is procedural casino-inspired *lighting*, not an AI-generated photograph. It is separate from `casino-panorama.png`, which is the image-generation agent's LDR visual background. Converting that PNG to `.hdr` would not recover real dynamic range and has not been done.

## Layout rules printed on the artwork

- Classic: place 4/10 pays 9:5, 5/9 pays 7:5, 6/8 pays 7:6. The don't side bars 12.
- Crapless: additional place 2/12 pays 11:2; 3/11 pays 11:4. The don't side is omitted. Seven wins the come-out; every other total establishes a point.
- Field: 2 pays double, 12 pays triple; the ordinary winning field numbers pay 1:1.
- Hardways: 4/10 pays 7:1, 6/8 pays 9:1. One-roll amounts on the classic board are profit payouts.

## Rebuild

```sh
python -m pip install svgwrite cairosvg
python scripts/build-boards.py
blender --background --python scripts/build-models.py
```

`cairosvg` requires a system Cairo library. On a Homebrew Mac, when library discovery needs help, prefix the board command with `DYLD_FALLBACK_LIBRARY_PATH=/opt/homebrew/lib`. The current `build-models.py` rebuilds only the refined table and its material textures; it preserves existing dice and environment files. Re-export dice from its editable `dice.blend` source when required. Models were built with Blender 4.5.4 LTS. Blender itself is a build-time dependency only; players do not need it installed. The generated GLBs are uncompressed glTF 2.0, with no decoder or network dependencies.

Validation: both SVGs were rasterized and visually inspected; the GLB headers, mesh counts, and material records were inspected; the dice and textured table were rendered in Blender Cycles and visually checked. The refined table was rendered again at 1600×1080 to check the cushion profile, cutout cup wells, material export, chip rack, and clear odds area. The SVG type uses generic Georgia/Times and Arial/Helvetica stacks without embedding font files.
