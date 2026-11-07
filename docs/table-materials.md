# Table surface materials

`src/table-materials.js` applies a shared material per named surface before the table becomes visible. It loads tiling PBR textures from `public/assets/material-table-*`; `scripts/build-table-materials.py` regenerates them and writes the texture metadata/contact sheet.

Albedo images use sRGB. Normal and roughness images use no color conversion. Wood color, normal, and roughness use the same physical UV1 mapping. Leather color follows the macro UV atlas; its physical surface detail uses UV1. Wood color is a 2K JPEG; other maps are at most 1K lossless PNG. Its matched maps tile together every four scene units with identical U/V scale. The printed betting felt keeps its separate board artwork and fiber maps.

| Surface | Approximate effective roughness | Treatment |
| --- | --- | --- |
| Dark hardwood | 0.50 | Darker scanned grain, restrained pores, satin varnish and HDR reflections |
| Oxblood leather | 0.69 | Grain and uneven wear, very low clearcoat |
| Rubber | 0.88 | Existing baked pyramid relief, matte surface |
| Brass | 0.53 | Brushed detail and restrained metallic reflections |
| Recessed black surfaces | 0.75 | Nonmetallic matte finish |

The roughness scalar is 1 when a map already encodes the target roughness. Multiplying a 0.5 map by another 0.5 scalar creates a much glossier 0.25 surface, which was a source of the previous plastic appearance.

Playing pieces use the same principle: clay chips retain their authored roughness and reduced wear-normal strength; dice retain the resin roughness map without an extra glossy multiplier. Solid dice have less clearcoat, while glass still transmits light. Phone studio lighting is balanced so the existing red/green/blue colors remain recognizable.

All twelve chip trays use unified, shared-edge shells instead of overlapping base/rim faces. The remaining shadow speckling was separately tested with shadows off and resolved with a 0.02 normal bias. Original table and chip assets remain unchanged; the optimized table is the active variant.

The dark wood uses the matched diffuse, OpenGL normal, and roughness scans from [Poly Haven Dark Wood](https://polyhaven.com/a/dark_wood), released under [CC0](https://polyhaven.com/license). The source is photographed dark cherry/mahogany veneer, tinted toward a darker walnut-style finish; it is not claimed to be a botanical walnut scan. Originals, hashes, creators, and the transformations are recorded in `assets/source/materials/dark-wood/provenance.json`. Other surface maps are original procedural assets.

The active optimized table uses board-local UV1, authored before the seven material batches are joined. Straight front/back boards have grain along their length; end boards run across the table depth; upright trestle supports have vertical grain. The broad shelf has exact shared-edge miter boundaries. Each tray and board selects a deterministic offset within the same photograph, so the twelve trays do not repeat identical knots. Flat redundant subdivisions are dissolved without moving the silhouette. The twelve internal wood support caps underneath the closed suede beds are omitted; exterior tray walls, bottom caps, shared-edge profiles and ten-segment corner curves remain intact. UV0 and all nonwood UVs retain their previous mappings.

The stain multiplies the source RGB by `[0.70, 0.86, 0.99]`, making it slightly darker than the previous finish. The matched normal uses strength `0.55`; clearcoat `0.16` with roughness `0.38` gives a restrained varnish reflection, and environment intensity `0.8` uses the real casino EXR. The diffuse texture is not brightened to fake reflections. Roughness remains scan-driven with a mean near `0.50`.

Regenerate with `python scripts/build-table-materials.py`, then `blender --background --python scripts/build-optimized-table.py -- --no-preview`. The latter writes the GLB and editable Blender source through temporary sibling files and verifies hashes for the original and legacy tables. `scripts/table_wood_uv.py` owns the physical projection. Focused tests verify upright/straight grain, constant physical density on every exported wood triangle, the material settings, original asset hashes, and the 35,000-triangle/seven-batch budget. Final table geometry is 34,508 triangles in seven batches (previously 34,926/seven).

Actual Three.js/Metal proof uses the runtime PBR controller and casino EXR, with matched before/after camera poses: `artifacts/wood-{before,after}-{trays,corner,legs,overview}.png`. The isolated fixture adds only the printed playing plane and floor; their four triangles and two draws are excluded from table-only statistics. Run `node scripts/render-table-wood.mjs after` to reproduce these four views on an isolated ephemeral port. No live game rooms are involved.
