# Graphics settings

Open the TV gear, then **Graphics**. Everything remains inside the 3D canvas. Admin phones have the same controls under **TV graphics**. Local TV choices persist in that browser; an explicit admin graphics update replaces them for that room without changing bets or dice.

| Setting      | Choices                     | Effect                                                                                                                                                                                                                                      |
| ------------ | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Frame rate   | Auto, 24, 30, 60            | Caps rendered frames without changing the shared physics timeline.                                                                                                                                                                          |
| Antialiasing | Auto, On, Off               | Controls native WebGL edge smoothing. Changing it rebuilds the graphics context while preserving the room and settings panel.                                                                                                               |
| Resolution   | Auto, 75%, 100%, 150%, 200% | Scales the 3D scene buffer. The interface retains native display resolution, capped at 4K; the panel reports both sizes.                                                                                                                    |
| Model detail | Auto, Full, Optimized       | Controls chip geometry. Full always uses the original detailed chips; Optimized always uses the smaller variant. Auto switches by projected size, with hysteresis. The table itself always uses the optimized, silhouette-preserving model. |
| Textures     | Auto, 1K, 2K, 4K, Native    | Caps each asset's longest image dimension. Native restores the original source up to GPU limits. Images are never upscaled, and HDR values remain HDR.                                                                                      |

These are texture dimensions, not video resolution. Most painted table/chip textures are at most 2K; the vector betting layout is also supplied as a genuine 4096×2048 raster, and the casino environment is 4K. Selecting Native cannot manufacture detail from a smaller source. UI text and join codes use dynamically sized native-resolution canvas textures.

The display targets are 1920×1080 and 3840×2160. On capable hardware, Auto starts at native display resolution up to a 4K pixel budget, including a 1920×1080 CSS viewport at device pixel ratio 2. Low-memory/software devices start conservatively. A reduced 3D resolution uses a linear-HDR offscreen target and a tone-mapped composite; the TV interface is drawn afterward at native resolution. Devices without renderable floating-point targets use a combined-resolution fallback, reported by the actual buffer metrics. Explicit supersampling choices remain available within GPU limits.

## Automatic defaults and the intro

On boot, the screen stays black until the models, surface maps, playing-piece textures, fonts and shaders are ready. A 30-second opening then fades in: close material views, two physical dice throws, real chip stakes and payouts, then the ordinary TV interface. The demonstration owns isolated snapshots and never changes the room's players or money. Escape skips it; an already-playing room goes directly to its live table.

Automatic settings ramp through conservative, medium and capability-recommended resolution, texture and chip-detail candidates. The first frames after each change are excluded from measurement; a final confirmation section uses the selected profile. Explicit choices always override the automatic profile. Low-memory/software devices keep conservative candidates. Reduced motion holds a stable camera; hidden tabs pause the opening and its measurements. See [opening validation](startup.md).

See [TV display QA](tv-display-qa.md) for measured glyph sizes, viewing-distance calculations, exact-resolution benchmarks, and the distinction between font size and visible character height.

The diagnostic compares rendered frame intervals against the requested frame budget, including refresh quantization for 24 FPS. Automatic FPS probes target 60 and can fall back to 30 or 24. Sparse measurements retain a conservative candidate; skipped openings without measurements use capability recommendations. Rendered FPS, actual resolution and texture cap are shown in Graphics. This calibration is evidence for this workload, not a guarantee for every later scene. **Retest automatic settings** replays the opening in a lobby; during an active game it measures the real table with the UI visible, without introducing demonstration players or interrupting play.

## Performance checklist review

The requested [Three.js Performance Checklist](https://marceloretana.com/checklist/threejs-performance-checklist) was reviewed against this scene. The implementation uses shared/instanced chip geometry, material batches, an indexed seven-mesh table, bounded texture sizes, cached static shadows, correct culling bounds, and explicit GPU-resource cleanup. The renderer avoids rebuilding stationary banks every frame. The table's optimization does not require switching between table LODs; optional chip detail is still useful because hundreds of distant chips otherwise dominate triangle counts.

Progressive pop-in was deliberately avoided: the table appears after critical models/textures/shaders are ready, matching the requested stable scene. KTX2 and mesh compression remain possible loading optimizations, but are not required for the measured frame-rate improvement. Deterministic disposal is used rather than relying on garbage-collection finalizers for GPU cleanup.
