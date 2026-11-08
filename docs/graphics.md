# Graphics settings

Open the TV gear, then **Graphics**. Everything remains inside the 3D canvas. Admin phones have the same controls under **TV graphics**. Local TV choices persist in that browser; an explicit admin graphics update replaces them for that room without changing bets or dice.

| Setting      | Choices                     | Effect                                                                                                                                                                                                                                      |
| ------------ | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Frame rate   | Auto, 24, 30, 60            | Caps rendered frames without changing the shared physics timeline.                                                                                                                                                                          |
| Antialiasing | Auto, On, Off               | Controls native WebGL edge smoothing. Changing it rebuilds the graphics context while preserving the room and settings panel.                                                                                                               |
| Resolution   | Auto, 75%, 100%, 150%, 200% | Scales the 3D scene buffer. The interface retains native display resolution, capped at 4K; the panel reports both sizes.                                                                                                                    |
| Model detail | Auto, Full, Optimized       | Controls chip geometry. Full always uses the original detailed chips; Optimized always uses the smaller variant. Auto switches by projected size, with hysteresis. The table itself always uses the optimized, silhouette-preserving model. |
| Textures     | Auto, 1K, 2K, 4K, Native    | Caps surface images. Critical chip lettering retains its dedicated 2K maps; table lettering has a separate native display budget. Native restores original sources up to GPU limits. Images are never upscaled, and HDR values remain HDR. |

These are texture dimensions, not video resolution. Most painted table/chip textures are at most 2K and the casino environment is 4K. The outlined betting layout is rendered independently of the surface-texture cap. Its preserved 2K/4K raster exports are available for older studies and authoring. Selecting Native cannot manufacture detail from a smaller source. UI text and join codes use dynamically sized native-resolution canvas textures. Chip lettering uses a dedicated full-face UV channel with 1,832 source texels across the wordmark, while its wear retains the original coordinates. Only the logo albedo and engraving normal retain a 2K minimum under lower surface settings; a smaller source is never enlarged.

The display targets are 1920×1080 and 3840×2160. On capable hardware, Auto starts at native display resolution up to a 4K pixel budget, including a 1920×1080 CSS viewport at device pixel ratio 2. Low-memory/software devices start conservatively. A reduced 3D resolution uses a linear-HDR offscreen target and a tone-mapped composite; the TV interface is drawn afterward at native resolution. Devices without renderable floating-point targets use a combined-resolution fallback, reported by the actual buffer metrics. Explicit supersampling choices remain available within GPU limits.

## Automatic defaults and the intro

On boot, the screen stays black until the models, surface maps, playing-piece textures, fonts and shaders are ready. A 30-second opening then fades in: close material views, two physical dice throws, real chip stakes and payouts, then the ordinary TV interface. The demonstration owns isolated snapshots and never changes the room's players or money. Escape skips it; an already-playing room goes directly to its live table.

Automatic settings ramp through conservative, medium and capability-recommended resolution, texture and chip-detail candidates. The first frames after each change are excluded from measurement; a final confirmation section uses the selected profile. Explicit choices always override the automatic profile. Low-memory/software devices keep conservative candidates. Reduced motion holds a stable camera; hidden tabs pause the opening and its measurements. See [opening validation](startup.md).

See [TV display QA](tv-display-qa.md) for measured glyph sizes, viewing-distance calculations, exact-resolution benchmarks, and the distinction between font size and visible character height.

The diagnostic compares rendered frame intervals against the requested frame budget, including refresh quantization for 24 FPS. Automatic FPS probes target 60 and can fall back to 30 or 24. Sparse measurements retain a conservative candidate; skipped openings without measurements use capability recommendations. Rendered FPS, actual resolution and texture cap are shown in Graphics. This calibration is evidence for this workload, not a guarantee for every later scene. **Retest automatic settings** replays the opening in a lobby; during an active game it measures the real table with the UI visible, without introducing demonstration players or interrupting play.

## Performance checklist review

The requested [Three.js Performance Checklist](https://marceloretana.com/checklist/threejs-performance-checklist) was reviewed against this scene. The implementation uses shared/instanced chip geometry, material batches, an indexed seven-mesh table, bounded texture sizes, cached static shadows, correct culling bounds, and explicit GPU-resource cleanup. The renderer avoids rebuilding stationary banks every frame. The table's optimization does not require switching between table LODs; optional chip detail is still useful because hundreds of distant chips otherwise dominate triangle counts.

Progressive pop-in was deliberately avoided: the table appears after critical models/textures/shaders are ready, matching the requested stable scene. KTX2 and mesh compression remain possible loading optimizations, but are not required for the measured frame-rate improvement. Deterministic disposal is used rather than relying on garbage-collection finalizers for GPU cleanup.

## Native print and selected wool validation

The native vector print, dedicated chip medallion maps and selected B wool were
checked with twelve players, full chip geometry, native textures, antialiasing
and an actual throw under the automatic camera. On the tested Apple M5 Pro,
both native [3840 × 2160](benchmarks/clarity-native-4k.json) and
[1920 × 1080](benchmarks/clarity-native-1080p.json) produced 360 frames in six
seconds, approximately 60 FPS with a 16.7 ms frame-interval P95. The harness
verified the actual scene and UI framebuffers rather than inferring them from
CSS dimensions. Triangle/draw totals include the rendering passes. These are
measurements for this device and workload, not a performance promise for every
GPU. Board-specific pixel tests and the retained SVG sources are documented in
[board design](board-design.md); chip source-density and texture-cap checks are
documented in [chips](chips.md).


## Optional effects

Open **Settings → Graphics → Effects** on the TV. Admin phones expose the same
three switches in Graphics. Each is **Off by default**, persists with the other
graphics choices, and stays under manual control during automatic calibration.

- **Lens flares:** subtle warm glints from bright lamps in the actual HDR casino.
  Table geometry occludes them. They appear only when a lamp is in view; top-down
  play usually has none. Native text and the QR card render afterward.
- **Local reflections:** a cached 256px HDR view of the nearby table in wood,
  brass and dice gloss. Six faces update over separate frames only after the
  dice, aiming and payouts are idle. The previous complete reflection remains
  during play. This is raster rendering, not ray tracing, and one probe has
  approximate parallax across the table. Unsupported devices leave it inactive.
- **Contact shadows:** a 4096px key-light shadow where supported, with a tighter
  contact bias, for clearer chip/dice grounding. The map changes only when play
  is idle; turning Off restores the original 2048px shadow and bias.

Enabling reflections can briefly pause the first time shaders and the prefilter
compile. The measured Apple/Metal prototype had 122–276ms cold updates versus
0.1–0.7ms warm staged updates. These are opt-in costs, not a universal 4K/60FPS
guarantee. Both reflection and high-resolution shadow resources are released on
Off; disabled flares own no GPU resources or rendering pass. A 4096px color/depth
shadow can add roughly 128MiB while enabled, on top of the retained baseline map. None affects dice
results, chip balances, or the configured cooldown. See
[the lighting study](optional-lighting-survey.md) for measured evidence and the
separate work required for genuine path-traced photographs.


### Optional-effect measurements

With all three effects explicitly enabled, full chip geometry, native surface
maps and antialiasing, the tested Apple M5 Pro produced about **60.0 FPS**
(**16.8ms P95**) in a twelve-player [native 3840×2160 settled table
view](benchmarks/optional-effects-native-4k.json). A twelve-player [native
1920×1080 automatic camera with an actual throw and
payout](benchmarks/optional-effects-native-1080p-throw.json) produced about
**59.3 FPS**, also **16.8ms P95**. Both actual scene and UI framebuffers were
verified, with zero browser errors. The throw run also allocated real visible-lamp
flare resources and refreshed a completed local probe after settlement.

These six-second warm measurements exclude first-use shader compilation. The
4K shot is a settled overhead view, where casino lamps are offscreen, so it is
not evidence for a 4K close-up throw or continuously visible flares. The
1080p run does include the moving-camera/throw workload. Device-specific results
remain separate from automatic settings and the effects' Off defaults.
