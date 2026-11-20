# Visual assets

These original project assets were generated on November 7, 2026 using the built-in OpenAI image generation tool. No third-party reference artwork was supplied. They are project assets, not claimed to be CC0 stock photography. Any project distribution should include them under the repository's chosen asset license.

| File | Size | Intended use |
| --- | --- | --- |
| `public/assets/brand-logo.png` | 1920 × 819 RGBA | Main crapsTV wordmark on dark backgrounds. The alpha channel is genuine transparency. |
| `public/assets/casino-panorama.png` | 1774 × 887 RGB | 2:1 generated casino panorama for a spherical background. |
| `public/assets/ui-chip.png` | 1312 × 1199 RGBA | Reward emblem, recap artwork, or lobby accent. The alpha channel is genuine transparency. |

The panorama is an **8-bit LDR generated image**, not measured HDR photography and not a true high-dynamic-range light probe. In Three.js, use `EquirectangularReflectionMapping` with sRGB color space for this texture. It can provide a background and modest image-based illumination, but it cannot represent the physical intensity of bright lamps. If using the separate Blender-rendered HDR environment, use that HDR for lighting and keep this panorama for the visible casino backdrop. Generative panoramic geometry and the wrap seam are approximate.

## Art direction

Premium late-night casino: oxblood, brushed brass, warm ivory, walnut, and jade felt. The wordmark uses a legible lowercase serif with a compact TV badge; the chip provides a matching dimensional motif. Source output files are preserved in the local image generation cache, and the production copies are bundled in this repository.

## Generation prompts

### Logo

> Use case: logo-brand. Asset type: production transparent PNG logo for a multiplayer casino party game. Primary request: an awesome refined retro-modern casino wordmark, exact text "crapsTV". Typography: extremely legible custom lowercase serif "craps" in warm ivory with subtle brass outline, "TV" a compact brass small-cap badge; small pair of ivory dice with dark pips above the wordmark, elegant restrained Art Deco line details. Premium playful late-night casino identity, not kitsch. Color palette: warm ivory, aged brass gold, tiny oxblood accents. Composition: horizontally centered wordmark filling the image with modest clear margin, isolated on fully transparent background. Constraints: correct spelling crapsTV, only this text, no slogan, no mockup, no solid backdrop, no excessive tiny details. Generate as high-quality polished standalone game brand asset.

Tool option: `transparent_background: true`.

### Casino panorama

> Use case: photorealistic-natural. Asset type: 360-degree equirectangular casino interior environment texture for a Three.js game, exactly 2:1 panoramic projection, intended as LDR spherical background. Primary request: a sumptuous intimate Art Deco casino at night, warm brass pendant lights and chandeliers, oxblood velvet, dark polished walnut, emerald jade gaming tables, cream architectural details. Camera at eye height in open space beside a craps table. Empty room without people. Photorealistic architectural panorama, straight horizon at vertical center, full floor below and ceiling above, spherical equirectangular distortion not a regular wide-angle photo. Soft cinematic practical lighting; deep shadow detail, warm gold highlights, elegant rather than gaudy. Central foreground kept uncluttered so the game table can be rendered in front. Constraints: no visible text, logos, watermark, no dice closeups, no first-person hands. Left and right edges should continue seamlessly, plausible panoramic geometry.

Tool option: `transparent_background: false`.

### UI chip

> Use case: product-mockup. Asset type: transparent game UI reward emblem, standalone PNG. Primary request: one beautiful thick casino chip, tilted 12 degrees in a near frontal three-quarter view, oxblood enamel body with warm ivory edge inlays and a brushed antique brass central medallion. Medallion carries a simple raised pair of dice with authentic recessed black pips, no text. Premium tactile retro-modern Art Deco casino aesthetic matching a brass, oxblood and jade game. High fidelity product lighting with crisp silhouette, slight soft self-shadow contained under chip. Composition: single centered object with generous transparent margin, not cropped. Constraints: genuinely transparent background, no room, no floor, no extra chips, no lettering, no watermark.

Tool option: `transparent_background: true`.

## Verification

All three generated images were visually inspected. The logo spells `crapsTV` correctly. Image metadata confirms alpha for the logo and chip, no alpha for the panorama, and a 2:1 aspect ratio for the panorama. No resizing, artificial HDR conversion, or image manipulation was used.

## Scanned wood PBR source

The darker satin wood material derives from [Poly Haven Dark Wood](https://polyhaven.com/a/dark_wood), [CC0-1.0](https://polyhaven.com/license), by Dimitrios Savva (photography), Dario Barresi (baking), and Rico Cilliers (tiling). Bundled source diffuse/normal/roughness maps and provenance live under `assets/source/materials/dark-wood/`. The runtime maps are color adjusted and resized; normals and roughness remain spatially matched. See [table materials](table-materials.md).

## Drinking Mode icons

The built-in image generation tool produced a concept sheet on November 20, 2026. The four production glyphs in `src/DrinkIcon.jsx` use Lucide's 24-unit grid, rounded caps, and two-unit strokes. Artwork uses deep felt green (`#0c3b2b`) and brass (`#a97f33`), with ivory (`#f7f1e3`) for outlines on dark surfaces. The phone navigation uses the same monochrome active and inactive colors as its other tabs.

> Use case: ui-mockup. Create a minimalist icon reference sheet for crapsTV, exactly 4 evenly spaced line glyphs, in a single horizontal row on flat ivory #fffaf0. Left to right: two tilted simple short glasses meeting for a toast; a pair of stacked flat casino tokens with small plus; a simple shield with a centered checkmark; one short tumbler with an outward northeast arrow. Match Lucide-style 24px UI icons, with very consistent rounded 2px strokes and 24px-grid proportions, drawn large for inspection. Only two ink tones: deep felt green #0c3b2b for main outlines and dark brass #94681f for a single semantic mark per icon. Main shapes unfilled; no other ink colors. Thin simple open strokes, balanced negative space, strict visual consistency, clear tiny silhouettes. No gradients, shadows, textures, 3D objects, faux depth, borders, lettering or labels.
