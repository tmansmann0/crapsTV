# TV resolution and viewing-distance QA

The TV interface targets a 16:9 65-inch display viewed from 8–14 feet. After seeing the larger HUD cover too much of the table and chips, the user chose a smaller default. **Compact** uses 67% of the whole HUD layout; **Large** retains the larger couch-viewing option. Settings → UI size switches between them and stores the local preference under `crapstv-tv-ui-size-v1`.

The physical calculations below explain the tradeoff and guide Large mode. They are not a requirement imposed on the user’s Compact preference. Browser screenshots and font metrics do not substitute for a physical TV check, individual visual acuity, room glare, viewing angle, or display calibration.

## Physical sizing

A 65-inch 16:9 panel is approximately 56.652 × 31.867 inches. For visible character height `p`, vertical resolution `v`, and viewing distance `d` inches:

`visual angle = 2 × atan((31.867 × p / v) / (2 × d))`

The result is converted from radians to arcminutes. Doubling character pixels from 1080p to 4K preserves physical size; increasing resolution without scaling the interface makes its text physically smaller.

| Visible character height at 1080p | Equivalent at 4K | At 8 feet    | At 14 feet   |
| --------------------------------- | ---------------- | ------------ | ------------ |
| 26 px                             | 52 px            | 27.47 arcmin | 15.70 arcmin |
| 32 px                             | 64 px            | 33.81 arcmin | 19.32 arcmin |
| 40 px                             | 80 px            | 42.26 arcmin | 24.15 arcmin |
| 56 px                             | 112 px           | 59.17 arcmin | 33.81 arcmin |

Microsoft's console guidance uses a minimum **rendered text body height** of 26 pixels at 1080p and 52 pixels at 4K, measured from visible ascenders through descenders. A CSS/canvas font size is not this measurement. Its guidance also recommends text scaling options. [Xbox Accessibility Guideline 101](https://learn.microsoft.com/en-us/xbox/accessibility/xbox-accessibility-guidelines/101)

As a separate human-factors reference, NASA's display guidance specifies a 15-arcminute minimum uppercase character height and prefers 24 arcminutes. That is a spaceflight standard, not a TV-game compliance requirement. For this panel at 14 feet, those angles correspond to approximately 25 and 40 **visible uppercase pixels** at 1080p, or 50 and 80 at 4K. Main results and room codes warrant the larger sizes. Mixed-case body-height metrics should not be mistaken for uppercase height. [NASA display guidance, F.5.1](https://www.nasa.gov/reference/appendix-f-vol-2/)

Both modes scale from a 1920 × 1080 logical design, retaining the same relative size at 4K. Safe margins remain 80 horizontal and 60 vertical pixels at 1080p, doubled at 4K; Compact shrinks the panels rather than the safe area. Runtime text metrics measure actual Manrope glyph bounds. Large-mode checks enforce the 26/52-pixel body-height target. Compact checks enforce fit, the requested 0.67 scale and consistent 4K scaling; they deliberately do not claim that every Compact label meets the Large-mode target.

The join card displays the host, port and path across up to two measured lines without ellipsis. Room-code query parameters are omitted from the printed address because the code is already prominent above it; the QR retains the complete automatic-join link. Address text stays separate from the QR column.

## Reproducible checks

```sh
node --test tests/benchmark-config.test.js tests/tv-readability.test.js
node tests/tv-readability.browser.mjs
BENCH_WIDTH=1920 BENCH_HEIGHT=1080 BENCH_DPR=1 BENCH_LABEL=tv-1080 npm run benchmark
BENCH_WIDTH=3840 BENCH_HEIGHT=2160 BENCH_DPR=1 BENCH_LABEL=tv-4k npm run benchmark
BENCH_WIDTH=3840 BENCH_HEIGHT=2160 BENCH_DPR=1 BENCH_RESOLUTION=75 BENCH_LABEL=tv-4k-scene75 npm run benchmark
```

Benchmarks default to Compact UI with explicit 100% resolution, 60 FPS, antialiasing on, full model detail, and native textures. `BENCH_UI_SIZE=large` selects Large mode for a separate capture. `BENCH_MODEL=auto` measures the distance-based model detail policy; `BENCH_DEV=1` uses source through Vite rather than the production build. `BENCH_CAMERA=table|room|auto` selects a view. Each run starts its own room and refuses an occupied port.

Every report records CSS viewport, device pixel ratio, GPU identity, requested/effective settings, actual WebGL drawing-buffer dimensions, and separate scene/UI resolutions when available. A requested resolution that does not match the measured scene fails the run. An Auto result is never labelled resolution-verified. Screenshots and reports are saved under `artifacts/`.

## Baseline evidence

On the tested Apple M5 Pro through Chromium/ANGLE Metal, the pre-update production scene with twelve players and twelve Pass Line bets rendered at verified 1920 × 1080 and 3840 × 2160 framebuffers. Both short samples held the explicit 60 FPS cap, with approximately 16.7–16.8 ms P95 frame intervals, 97 draw calls and 2,145,010 triangles. This establishes a local-device baseline, not a performance promise for other hardware.

The full baseline reports are `artifacts/tv-baseline-1080.json` and `artifacts/tv-baseline-4k.json`. The isolated 1080p/4K layout and glyph evidence is in `artifacts/tv-readability.json` and `artifacts/tv-ui-{compact,large}-*-*.png`. In Large mode, primary room-code glyphs measure about 54/108 pixels, the result heading 38.9/77.8 pixels, and the sampled mixed-case gameplay status line 37.6/75.2 pixels at 1080p/4K. Compact scales those glyphs to 67% of those heights. These are glyph measurements; declarations in `TV_TYPE` are font sizes.

## Final verification

The QA matrix covers sixteen captures: gameplay, settings, graphics and intro, each in Compact and Large at 1080p and 4K. Both modes are checked for native framebuffer dimensions, panel fit and text bounds. Large mode enforces 26/52-pixel primary alphanumeric text in the join/status/settings/graphics panels for the fixture address; the small join eyebrow and QR caption are secondary and exempt. Longer addresses are measured separately for full fit, rather than assumed to meet that height. A boundary case in the Camera value was enlarged to 38 font pixels, producing 27.36/54.72 visible pixels for “TABLE” in Large mode. Decorative standalone icons are not treated as text. The Compact default and saved Large preference are tested separately, including the actual UI-size control and preference persistence.

A further 32 join-card cases cover local addresses, numeric hosts, public Pages paths and longer public paths at 1280, 1600, 1920 and 3840 pixels wide in both sizes. They verify that the displayed host, port and path are complete, query/hash tokens are omitted, and no text collides with the QR.

The full-scene native captures `artifacts/final-labels-1080.png` and `artifacts/final-labels-4k.png` also report native scene and UI buffers. With 75% 3D resolution on a 4K viewport, `artifacts/tv-final-4k-scene75.json` uses the explicit 4K texture option and verifies a **2880 × 1620 scene** and **3840 × 2160 UI**, approximately 60 FPS, 16.7 ms P95 frame interval, 88 draw calls and 489,734 triangles on the same M5 Pro. `artifacts/tv-final-4k-scene75.png` is the corresponding full-size screenshot. This confirms the lower-resolution 3D setting does not blur the TV interface.

The benchmark fails a non-native UI result by default. `BENCH_REQUIRE_NATIVE_UI=0` may be used only to measure a known unsupported-device fallback, which remains explicitly marked `nativeUIVerified: false` in its report.

The Graphics panel names the two resolutions explicitly: the performance line identifies the **3D** raster, while the next line identifies **UI** resolution and the map limit. For example, a 4K display at 75% reads 3D 2880 × 1620 with UI 3840 × 2160 and a 4096-pixel map budget. These values describe different rendering stages and should not be collapsed into a single “4K” claim.

The Compact/Large matrix passed all sixteen cases with the current size preference implementation. Missing storage selected Compact; selecting either size by the rendered control persisted across UI recreation. Whole-panel dimensions matched the 0.67 Compact ratio, and both modes doubled at 4K. Compact text below the Large-mode guideline is recorded as an intentional tradeoff, not a test failure.

The final table-level-camera release was remeasured with twelve players, Auto chip detail, explicit 100% resolution, antialiasing on and native textures. The [4K report](benchmarks/tv-4k.json) verifies both scene and UI at 3840×2160 during a throw, with 60.00 FPS and a 16.7 ms P95 frame interval on the same Apple M5 Pro. Its mean draw count is about 130 and mean triangle count about 1.09 million: close camera shots intentionally retain more detailed chips than the distant idle baseline. The report includes the exact built module names, settings, resolution evidence and empty browser error list.

The matching [1080p report](benchmarks/tv-1080.json) verifies 1920×1080 scene/UI buffers in the close overhead betting view, also at 60.00 FPS and 16.7 ms P95. It averages about 77 draws and 491,000 triangles. Both measurements use Compact UI and twelve players; the 4K sample includes a throw while the 1080p sample measures betting.

## Logo chips and Heritage felt update (0.9.0)

The final production update was remeasured on the same Apple M5 Pro with twelve players, Compact UI, explicit 100% scene resolution, AA on, Auto chip detail and native textures. The [native 4K throw sample](benchmarks/v09-native-4k.json) captured 600 rendered frames over ten seconds: 60.00 FPS, 16.7 ms P95, about 111 draws and 887,000 triangles per frame. Both scene and UI buffers were verified at 3840 × 2160, with no browser errors. The [1080p betting sample](benchmarks/v09-native-1080.json) verifies both buffers at 1920 × 1080. These measurements include the new wood UVs/materials, actual logo chips, mapped Heritage board and corrected friction. They describe this device and workload rather than a universal 60 FPS guarantee.
