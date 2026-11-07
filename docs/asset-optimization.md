# Optimized table and distant chips

The optimized files are separate variants. The previous table/variant sources and the original detailed chip are preserved byte for byte.

| Asset                                     | Before  | Optimized | Reduction |
| ----------------------------------------- | ------- | --------- | --------- |
| Player table triangles                    | 217,448 | 37,852    | 82.6%     |
| Player table mesh/material draws per pass | 102     | 7         | 93.1%     |
| Detailed logo chip triangles              | 10,098  | 8,440     | 16.4%     |
| Distant logo chip triangles               | 10,098  | 1,280     | 87.3%     |

These are asset counts, not an FPS guarantee. A shadow pass draws the applicable meshes again, and the scene's dynamic chips, text, environment and resolution also affect frame rate. Full scene performance is measured separately by the runtime.

## Table integration

Load `table-player-rails-optimized.glb` instead of `table-player-rails.glb`. Keep using `table-player-rails-layout.json`: seat centers, all 120 chip slots, board position, tray floors, crown height and collision bounds are unchanged. No new shader hook is required. Existing normal/roughness mapping is embedded, including the rubber wall maps on UV channel 1.

The rubber pyramids are now a 256×1024 tangent-space normal map plus a roughness map (`table-rubber-normal.png`, `table-rubber-roughness.png`). Their three staggered rows match the earlier geometry. The underlying flat wall is brought to the former pyramid-tip contact envelope at X=±5.42 and Z=±2.71, so the current physics walls remain aligned. The crown's original vertices and silhouette are retained exactly.

Tray geometry uses appropriately sized rounded profiles instead of dense micro-bevels. Coplanar geometry is dissolved, hidden dealer chip placeholders are removed, and compatible static parts are joined by material. The runtime already creates the dealer inventory using its chip factory, so there is no missing live rack content and no doubled inventory. The optimized static model has seven material batches. The physical tray proportions and floor Y=0.675 remain unchanged.

## Chip integration

The active factory uses `chip-logo-lod.glb` for distant bank/rack chips and wagers, and `chip-logo.glb` for close shots and phone/product previews. The original `chip.glb` and `chip-lod.glb` remain unchanged. Both active variants share the four material names (`ChipBase`, `ChipInlay`, `ChipEngraving`, `ChipMetal`), face/back/side UV atlas, one-unit X/Z bounds, and 0.13 thickness. Recoloring and wear work unchanged. Both carry the actual logo's recessed normal-map engraving; the LOD retains the edge inserts, face recess and brass rings with fewer radial segments. Shared external atlas maps avoid duplicate embedded image payloads. See [chip source and engraving proof](chips.md).

A renderer can select LOD by projected chip size or camera distance and apply hysteresis to avoid rapid switching. Distant banks can always use LOD while the detailed original remains available for close-up product previews.

## Rebuild and verify

```sh
blender --background --python scripts/build-optimized-table.py
blender --background --python scripts/build-chip-lod.py
```

Outputs include packed editable sources in `assets/source/`, model-specific stats JSON, and overview/close-up renders. The table script records and checks the SHA-256 of both older table models and both older table sources. The chip script checks the original chip GLB/source hashes.

Validation includes exact crown-vertex comparison, all 120 tray-floor positions, material/UV-channel inspection, unchanged source hashes, and matched overview plus low-angle rubber renders. The chip LOD is also rendered at product scale to check its atlas, inserts, wordmark, silhouette and material split. The LOD is intended for distance; the original remains the close-up-quality asset.

## Measured runtime result

An isolated twelve-player game at 1600×1000 on Chrome/ANGLE Metal, Apple M5 Pro, measured 15.00 FPS before changes and 60.00 FPS after. Idle draw calls fell from 544 to 97; triangles drawn per frame, including shadow work, fell from 4,637,532 to about 490,000. A separate cinematic throw run also measured 60.00 FPS. These measurements describe this machine and scene, not a guarantee for every GPU.

The original renderer deliberately capped hardware frames at 15 FPS idle and 30 FPS during throws. Hardware now renders on every animation frame. Fixed lighting reuses its shadow map until objects move, change, or switch detail. Compatible chip materials share instances, wagers share one set of batches, and stationary banks are rebuilt only when state or visible chip transfers change.

Chip detail is selected per chip, rather than from a whole batch's center. Separate high/low instance buffers share the source geometry and materials; they retain stable identities for contact animation and upload transforms only when needed. Auto uses a 128–160 rendered-pixel hysteresis band; the low mesh's 32-sided rim is within about 0.4 pixels of the circle at that threshold. Close views and the Full setting retain the original geometry. The LOD calculation uses actual 3D-buffer pixels, including HiDPI scaling.

At native 3840×2160, the measured Auto scene dropped from 2,145,010 drawn triangles to roughly 490,000 without increasing the original 97 draw calls. The exact final UI/label pass adds its own small draw budget. See [TV display QA](tv-display-qa.md) for explicit 1080p/4K measurements and the tested GPU; resolution verification is required before calling a result 4K.

Run `npm run benchmark` for the idle scene. Set `BENCH_ROLL=1` for a throw and `BENCH_LABEL=custom-name` for separate JSON/screenshot output in `artifacts/`. Each run uses its own temporary server, twelve test players, and a real WebGL browser; it does not join existing rooms.

The final tray pass removes overlapping base/rim bands on all twelve trays and fixes degenerate horizontal wood UVs. Board-local UVs keep top-panel miters and vertical leg grain physically coherent. Denser corner arcs preserve close-up silhouettes; removing twelve fully hidden support caps left 34,508 triangles. Rebuilding the four recessed cupholders as clean rounded collars and closed bowls adds 3,344 triangles, giving 37,852 active triangles in the same seven batches. The 38,500-triangle budget keeps smooth close-up cup silhouettes without retaining the broken decimated profiles. See [table materials](table-materials.md) for the darker satin PBR finish and actual-render comparisons.
