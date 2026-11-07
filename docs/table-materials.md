# Table surface materials

`src/table-materials.js` applies a shared material per named surface before the table becomes visible. It loads tiling PBR textures from `public/assets/material-table-*`; `scripts/build-table-materials.py` regenerates them and writes the texture metadata/contact sheet.

Albedo images use sRGB. Normal and roughness images use no color conversion. Wood color, normal, and roughness use the same physical UV1 mapping. Leather color follows the macro UV atlas; its physical surface detail uses UV1. Wood color is a 2K JPEG; other maps are at most 1K lossless PNG. Its matched maps tile together every six scene units, tested at the 1K texture cap and 75% render scale. The printed betting felt keeps its separate board artwork and fiber maps.

| Surface | Approximate effective roughness | Treatment |
| --- | --- | --- |
| Dark hardwood | 0.50 | Scanned grain and pores, restrained satin clearcoat |
| Oxblood leather | 0.69 | Grain and uneven wear, very low clearcoat |
| Rubber | 0.88 | Existing baked pyramid relief, matte surface |
| Brass | 0.53 | Brushed detail and restrained metallic reflections |
| Recessed black surfaces | 0.75 | Nonmetallic matte finish |

The roughness scalar is 1 when a map already encodes the target roughness. Multiplying a 0.5 map by another 0.5 scalar creates a much glossier 0.25 surface, which was a source of the previous plastic appearance.

Playing pieces use the same principle: clay chips retain their authored roughness and reduced wear-normal strength; dice retain the resin roughness map without an extra glossy multiplier. Solid dice have less clearcoat, while glass still transmits light. Phone studio lighting is balanced so the existing red/green/blue colors remain recognizable.

All twelve chip trays use unified, shared-edge shells instead of overlapping base/rim faces. The remaining shadow speckling was separately tested with shadows off and resolved with a 0.02 normal bias. Original table and chip assets remain unchanged; the optimized table is the active variant.

The dark wood uses the matched diffuse, OpenGL normal, and roughness scans from [Poly Haven Dark Wood](https://polyhaven.com/a/dark_wood), released under [CC0](https://polyhaven.com/license). The source is photographed dark cherry/mahogany veneer, tinted toward a darker walnut-style finish; it is not claimed to be a botanical walnut scan. Originals, hashes, creators, and the transformations are recorded in `assets/source/materials/dark-wood/provenance.json`. Other surface maps are original procedural assets.
