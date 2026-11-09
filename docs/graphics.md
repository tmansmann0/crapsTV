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

After the first complete calibration, its measured Auto base profile is saved
locally. Later openings keep that same quality from the first visible frame,
while still playing the full cinematic. An already-playing room also uses the
saved profile. **Retest automatic settings** deliberately measures and saves a
new result; skipping an opening or cancelling a Retest preserves the last good
record. Manual graphics/effect choices keep their existing separate storage.
Only a meaningful GPU/resource change or a much larger pixel workload invalidates
the automatic cache. This stores no room balances, tokens or gameplay settings.

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
three controls in Graphics. Each offers **Auto / On / Off**. Fresh preferences
use Auto. Existing saved On/Off choices remain explicit overrides; select Auto
or reset graphics to Auto to opt an older browser into the new behaviour.

- **Lens flares:** subtle warm glints from bright lamps in the actual HDR casino.
  Table geometry occludes them. They appear only when a lamp is in view; top-down
  play usually has none. Native text and the QR card render afterward.
- **Local reflections:** a cached 256px HDR view of the nearby table in wood,
  brass and dice gloss. Six faces update over separate frames only after the
  dice, aiming and payouts are idle. The previous complete reflection remains
  during play. This is raster rendering, not ray tracing, and one probe has
  approximate parallax across the table. Unsupported devices leave it inactive.
  With reflections active, walnut uses a satin finish with softer highlights,
  stronger grain relief and grain-aligned varnish variation from its existing
  scan maps. Turning reflections Off restores the original wood exactly.
  See the [matched wood close-up](screenshots/wood-satin-before-after.png)
  (previous finish on the left, satin finish on the right) and
  [native 4K comparison data](benchmarks/wood-satin.json).
- **Contact shadows:** a 4096px key-light shadow where supported, with a tighter
  contact bias, for clearer chip/dice grounding. The map changes only when play
  is idle; turning Off restores the original 2048px shadow and bias.

Enabling reflections can briefly pause the first time shaders and the prefilter
compile. The measured Apple/Metal prototype had 122–276ms cold updates versus
0.1–0.7ms warm staged updates. These are first-use costs, not a universal 4K/60FPS
guarantee; automatic qualification excludes warm-up frames. Both reflection and high-resolution shadow resources are released on
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


## Matched effect comparison

The [4K comparison viewer](../public/studies/effects/index.html) includes a matched
close-up of actual chip/dice/walnut assets, plus an actual HDR-lamp-facing view.
Each pair keeps camera, exposure, lights and material parameters identical;
selectors isolate local reflections, contact shadows or lens flares. Both images
zoom and pan together. Lossless WebP delivery preserves native GPU pixels, and
switching Off restores the exact original render. The preserved original-flare
option shows the 0.14.0 optical treatment under identical lighting.

The 0.14.1 flare uses a wider soft halo and visible but restrained ghosts. Its
anchor sits slightly inside the faceted HDR shell; the previous tiny offset
could let that shell suppress its own light marker. Actual HDR-lamp tests now
cover native and scaled rendering, visible output beyond the white shade,
solid/instanced-chip occlusion, exact Off restoration and GPU cleanup. A downward
close-up still has no flare when no actual lamp is in the camera's view.

Generate the comparison with `npm run study:effects` (requires the `cwebp`
authoring CLI). This is an isolated renderer and never changes a live room.


### Clearer wood and dice reflections

The [reflection-strength viewer](../public/studies/reflections/index.html) compares
0.14.1's previous On finish against a richer 0.14.2 finish, plus a high-polish
preview. It includes the exact same chip/dice/walnut shot and a tighter dice shot,
with current-On or Off baselines, shared zoom/pan and native lossless captures.
Camera, lighting, exposure, probe origin/resolution, wear and colour maps stay
fixed. Flares and contact-shadow upgrades are disabled in every strength capture.

Local reflections now apply the richer finish only after a completed probe is
available. Wood retains its grain/pores with a clearer varnish; dice retain the
same handling scratches with a clearer resin coating. Their roughness multiplier,
coating spread and reflection gain change; the actual normal, colour and
roughness images remain intact. High polish is a comparison-only alternative.

The finish controller snapshots shared-material values once, handles late dice
materials and restores them exactly on Off, canceled startup, disposal or errors.
Probe capture temporarily uses the baseline finish to prevent accumulating
changes or feeding a completed local reflection back into itself. It adds no
textures, geometry, draw passes or per-frame scene traversals. These remain
approximate cached raster reflections, with the existing 256px fixed probe;
this change does not claim per-object parallax or ray-traced mirror images.


## Measured automatic effects

After the base opening/calibration completes, Auto waits for a visible, safe
idle table. It records 45 actual rendered-frame intervals, tries eligible
reflections/contact shadows, waits for real GPU resources and a further 750ms
warm recovery, then measures 60 trial frames. A candidate must fit both the
frame budget and a 15% allowance against its baseline. Automatic effect tests
never lower the selected base resolution, frame rate, texture or model settings.
The TV menu shows the resolved **Auto · On/Off** result and a checking status.

A failed full candidate retries reflections without the large shadow map.
Flares receive their own incremental trial when a real HDR lamp is visible;
a top-down view leaves that trial deferred. Software renderers decline Auto
effects; low-memory devices decline heavy effects. Unknown memory permits a
reflection trial but conservatively declines the roughly128MiB shadow upgrade.
Explicit On remains available on supported rendering hardware.

Accepted automatic effects continue watching gameplay, including rolling and
payout frames. Two consecutive bad 60-frame windows queue a fallback, applied
only at the next safe idle. It does not retry repeatedly; **Retest automatic
settings**, a preference change or a new renderer starts fresh qualification.
Hidden tabs, loading, base calibration and resource warm-up never contribute
performance samples. Changing Auto resources rechecks safety at the actual draw,
so a throw beginning between a decision and the next frame cannot trigger an
allocation or cleanup mid-flight. Manual On/Off intent is always honoured.

Qualification remains device-local. The shared room stores only Auto/On/Off
preferences, and no diagnostic changes the authority's balances, cooldown or dice.
The isolated Auto browser proof validates real45/60 timings, actual probe/shadow
readiness, preserved aim/throw resources, unchanged ledger and manual persistence.

## Persistent-rack workload (0.16.0)

With twelve players, mixed physical banks, automatic chip detail, native textures,
AA and all optional effect switches enabled, a warm six-second throw/payout run
measured 60.0 FPS at both native 1920×1080 and 3840×2160 on the tested Apple M5 Pro.
P95 intervals were 16.8/16.7 ms respectively, with zero browser errors and verified
scene/UI framebuffer dimensions. These measurements include the larger chip
inventory and automatic camera; they exclude cold shader compilation and are not
a guarantee for other devices. Actual HDR flare visibility depends on the shot.
Full reports: [1080p](benchmarks/bank-racks-1080p.json) and
[4K](benchmarks/bank-racks-4k.json).
