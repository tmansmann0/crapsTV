# Original table, dice, and lighting assets

These assets were authored for crapsTV, without downloaded third-party meshes or board artwork. They follow the repository's license. The editable sources and deterministic build scripts are included.

| File | Purpose |
| --- | --- |
| `public/assets/table.glb` | Rounded walnut table, oxblood padded rail, brass inlay, jade playing surface, four pedestals |
| `public/assets/dice.glb` | One ruby casino die with ivory pip inlays and softly beveled edges |
| `public/assets/board-classic.svg` | Editable vector classic craps layout |
| `public/assets/board-crapless.svg` | Editable vector crapless layout, including 2, 3, 11, and 12 place boxes |
| `public/assets/board-*.png` | 2048×1024 raster exports of the SVG layouts for texture-loader fallback |
| `public/assets/casino-studio.hdr` | Genuine scene-linear RGBE environment, 1024×512, for image-based illumination |
| `public/assets/table-preview.png`, `dice-preview.png` | Blender Cycles QA renders, with transparent backgrounds |
| `assets/source/table.blend`, `dice.blend` | Editable Blender 4.5 LTS scene files |

## Three.js integration

Both GLBs use the glTF Y-up convention. The table is centered on the origin, 12 units wide along X and 6.7 units deep along Z. The felt surface is at Y=0. The rail is approximately 0.27 units high; the pedestals extend downward. The SVG or PNG board can be put on a `PlaneGeometry(10.84, 5.40)` with `rotation.x = -Math.PI / 2`, positioned at Y=0.012. Do not bake the classic texture into the shared table model: swap the board plane texture for crapless mode.

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

Use `RGBELoader` and `EquirectangularReflectionMapping` for `casino-studio.hdr`. This file contains actual scene-linear values from approximately 0.0398 to 17.875, with warm wall-light lobes and overhead softboxes. It is procedural casino-inspired *lighting*, not an AI-generated photograph. It is separate from `casino-panorama.png`, which is the image-generation agent's LDR visual background. Converting that PNG to `.hdr` would not recover real dynamic range and has not been done.

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

`cairosvg` requires a system Cairo library. On a Homebrew Mac, when library discovery needs help, prefix the board command with `DYLD_FALLBACK_LIBRARY_PATH=/opt/homebrew/lib`. Models were built with Blender 4.5.4 LTS. Blender itself is a build-time dependency only; players do not need it installed. The generated GLBs are uncompressed glTF 2.0, with no decoder or network dependencies.

Validation: both SVGs were rasterized and visually inspected; the GLB headers, mesh counts, and material records were inspected; the dice and textured table were rendered in Blender Cycles and visually checked. The original SVG type uses generic Arial/Helvetica/sans-serif without embedding font files.
