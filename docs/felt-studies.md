# Felt material studies

These studies answer the repetitive grain and insufficient fuzz in the table. The user selected **B — Soft wool felt, material only**, explicitly removing raised strands. Its shading now ships on the playing felt and player trays; A and C remain historical comparison options. The gallery at `/studies/felt/index.html` compares the same actual Three.js scene, lighting and camera in native 3840 × 2160 images. The close view reveals the fibre response; the wider view shows whether it survives ordinary play distance.

## What caused the repetition

The artwork contains a regular diagonal hatch clipped into dark betting regions, independent of the physical material. The normal texture also repeats every 0.46 world units. Increasing the normal strength alone exaggerates both forms of regularity. `stripBoardHatch` removes only those large, thin, dark hatch paths, preserving the board lettering, regions and bet anchors. The artwork agent uses that same helper while moving the printed UI to vector geometry.

The new atlas contains 19,000 deterministic, randomly oriented, short curved fibres rather than a woven grid. World-space sampling combines three rotated samples with incommensurate scales and offsets, restores variance lost to blending, and varies the nap gently over a much larger area. Gold printed ink is masked out of the fibre normal and sheen response. This is decorrelated texture sampling, not a full histogram-preserving stochastic texture implementation.

## Options

| Option | Surface | Geometry at the close view |
| --- | --- | --- |
| A — Fine casino baize | Closely matted fibres, broad restrained cloth sheen | None |
| B — Soft wool felt (selected) | Soft cloth sheen, decorrelated fine-fibre normals and nap roughness; no raised strands | None |
| C — Deep brushed nap | Stronger grazing response and deeper fine fibre tips | One additional draw, 50,000 ribbons / 100,000 triangles, maximum 0.0032 world-unit height |

All three preserve the selected green/red printed colors. The selected B material has no added geometry or hair tips. C alone retains a deterministic instanced batch in the study, not one object per strand. Its short fibres respect painted ink and depth-test against chips and dice, and fade completely out in the wider view. The maximum width is 0.0006 world units. The atlas is 1024² RGBA (about 2.49 MB on disk; about 5.3 MiB with GPU mipmaps); only the unselected C study needs the 0.8 MB instance buffer. No displacement distorts the betting layout, and no full-table fur shells are used.

The unselected C raised-fibre batch deliberately covers only the fixed macro comparison area. Production use would need bounded, stable patches around the close camera target, with the same maximum visible instance count. Its scattering is an inexpensive art-directed cue, supported by the physical cloth base; it is not a physically complete hair shader. One-frame draw/triangle counts in `manifest.json` are not a device-independent 60 FPS guarantee.

## Production integration

`src/felt-material.js` owns the reusable world-space shading, with selected B values independent of the old amplified C surface recipe. `createBoardMaterial` applies it after the playing-felt base settings; the board artwork renderer subsequently supplies native-resolution ink albedo before the wool shader derives its bright-ink mask. This keeps printed letters smooth and clear while dark cloth fills retain soft wool response. Normal and roughness do not displace the betting geometry. The shader is also applied to horizontal table/tray felt through the table material loader.

The packed atlas is part of the critical asset readiness gate, registered with texture quality management, and disposed with the owning board/table resources. Failed table atlas loads release all successful peer texture requests. Existing American walnut, B padding and selected chip wear are unchanged. `surfaceProfile:false` preserves historical study recipes. The explicit `selectedFelt=soft-wool` parity fixture compares independently authored reference values with the production factories.

## Research and rationale

- [Three.js MeshPhysicalMaterial](https://threejs.org/docs/pages/MeshPhysicalMaterial.html): the built-in sheen layer models cloth/fabric response. Physical effects have a per-pixel cost, so the study reuses that layer rather than adding a second full cloth BRDF. This project uses Three r180; newer documentation features are not assumed to exist.
- [Filament material model](https://google.github.io/filament/Filament.md.html): the cloth model and Charlie distribution explain the soft grazing lobe characteristic of cloth. A larger surface normal is not a replacement for fibre scattering.
- [Heitz and Deliot, stochastic texture tiling](https://eheitzresearch.wordpress.com/738-2/): decorrelation and contrast preservation help avoid recognizable repeats and washed-out blended detail. These studies use a simpler three-sample blend with variance compensation, not their complete histogram-preserving method.
- [Lengyel et al., Real-Time Fur over Arbitrary Surfaces](https://pixl.cs.princeton.edu/pubs/Lengyel_2001_RFO/index.php): shells and fins can supply actual fibre/silhouette depth. Rather than applying layered fur across the entire table, the study tests a small, shallow instanced ribbon patch only in macro views.
- [Physically-Based Shading at Disney](https://disneyanimation.com/publications/physically-based-shading-at-disney/): physically inspired, art-directable material controls motivate keeping fine fibre normals, broad nap variation and sheen independently adjustable.

## Reproduce

```sh
python3 scripts/build-felt-study.py
node scripts/render-felt-studies.mjs
node --test tests/board-hatch.test.js tests/felt-study.test.js
```

The capture process uses an ephemeral local Vite server and isolated headless Chromium, without changing the active game room, restarting the player's server, or retouching the resulting images.
