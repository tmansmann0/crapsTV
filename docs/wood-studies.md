# Furniture wood material studies

**Selected for production:** the user chose option 2, Clear scratches. The runtime table loader now uses American walnut with the exact reviewed finish and the central selected felt/padding profile. It loads only American’s four maps; the reversible study controller and all alternative scan sets remain available for comparisons. Legacy comparison mode is `createTableMaterials(renderer, { surfaceProfile: false })`.

The first A–D previews amplified the same striped cherry/mahogany veneer. At the shelf and tray scale, the broad dark streaks read like a repeated printed pattern. Stronger normal maps and roughness contrast accentuated those streaks; copying the same pores onto the clearcoat also made the finish look embossed. An independent audit confirmed the existing albedo/normal/roughness colour spaces and isotropic UV1 scale are correct. This pass therefore changes the wood source and finish structure instead of increasing relief again.

Three reversible, real Three.js candidates use matched CC0 Poly Haven scans by Jenelle van Heerden:

| Candidate | Source | Finish |
| --- | --- | --- |
| **American — recommended** | [American Walnut Veneer](https://polyhaven.com/a/american_walnut_veneer) | Quiet fine pores, warm dark stain, thin satin varnish |
| Smoked | [Smoked Walnut Veneer](https://polyhaven.com/a/smoked_walnut_veneer) | Broader flowing figure, warm dark finish |
| Natural | [Natural Walnut Veneer](https://polyhaven.com/a/natural_walnut_veneer) | More contrasting natural figure; still quite striped at distance |

All three source scans are one metre square. A 3.6-scene-unit isotropic texture tile uses the existing board-local physical UV1, keeping grain along the boards and legs without any geometry/UV changes. The albedo is darkened with a transparent stain multiplier in linear light, preserving the photographed grain. Substrate normals remain restrained (0.24–0.34); the distinct smooth varnish layer has 0.34–0.40 weight and 0.30–0.32 roughness, rather than inheriting the pore normal. Actual scanned roughness and pore occlusion remain aligned with the albedo. The 16-bit scalar source PNGs are explicitly normalized before conversion to runtime RGB8 so their roughness/AO range survives Pillow conversion.

`scripts/build-wood-studies.py` downloads and verifies the source files, then writes the preview maps. `assets/source/materials/wood-studies/provenance.json` and `public/assets/wood-studies/manifest.json` record direct source URLs, authors, [CC0 licensing](https://polyhaven.com/license), dimensions, transforms, source/runtime hashes and the preserved original wood-map hashes. Original game maps and all models remain unchanged and available for rollback. The preview-only `src/wood-look.js` controller restores original maps/material properties and disposes only its own textures; the live game does not import it.

`scripts/render-wood-studies.mjs` captures each candidate under the same native-4K hero/wide camera, lighting, rounded table and mixed material scene. The six actual 3D images are `artifacts/wood-study-{american,smoked,natural}-{hero,wide}.jpg`; `artifacts/wood-studies.json` records camera settings, selected wood and geometry hash. A–D captures are retained. All three refined chip-wear comparisons then use American walnut so differences in chip wear can be judged independently.

Known construction cues retained for this material-only comparison: bevel projection can change the grain's UV phase between adjoining top/side surfaces, and small cut ends have long-grain rather than a separate end-grain atlas. Fixing those would require a separate UV/material-layout pass; no model changes are hidden inside these studies.

## Selected live wood

Option 2 uses American walnut in the production table factory, loading only its
four maps. The finish matches the approved preview: normal .34, clearcoat .40,
coat roughness .30, environment intensity .85 and pore AO .24, with no pore
normal on the varnish. The other two scans are comparison assets only. Passing
`surfaceProfile: false` to the table factory reproduces the original materials
for historical comparisons; default players receive the selected finish.
