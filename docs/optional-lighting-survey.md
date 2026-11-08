# Optional higher-fidelity lighting survey

Research checkpoint: 2026-11-07. This document separates candidate architecture
from the local-probe implementation evidence below. The game uses Three r180 WebGL,
custom physical-material shader hooks, instanced chips and a native-resolution
vector-ink pass. Keep any additional effect off by default and keep native UI
and printed betting information outside low-resolution postprocessing.

The TV Graphics **Effects** submenu now offers three independent manual options,
all Off by default: lens flares, local reflections and contact shadows. They
retain the current WebGL renderer and shader materials. No setting here enables
path tracing or changes game physics, roll deadlines or the ledger.

Implementation checkpoint: `src/local-reflections.js` implements the cached
256px local-probe option. `node scripts/check-local-reflections.mjs` verifies
actual table/chip/dice assets, selected PBR materials, native vector print and HDR
lighting at 1920×1080 in an isolated renderer. Its matched capture changes 549,941
pixels (mean absolute channel difference 1.37); disabling returns **exactly the
original pixels**, texture count 40 and geometry count 29. The enabled warm cache
uses 45 textures/40 geometries, including the probe's PMREM workspace, and estimates
33.2 MiB incremental texture storage. Late dice registration and interrupted partial
capture are covered, with zero JS/GL errors.

The captured Apple/Metal run measured warm face/commit updates at 0.1–0.7 ms with a
GPU completion wait. Cold shader creation cost 201 ms on the first face, 276 ms on the
first downward board view and 122 ms on the initial prefilter. This is a meaningful
one-time opt-in limitation, not a 60 FPS guarantee; do not hide it behind warm-only
averages. Update timings, exact off/on comparisons and error output remain in
`artifacts/local-reflections/report.json`. These proofs do not cover a 12-player
native 4K workload or a new renderer context on every possible device.

## Implemented live effects

**Local reflections** and **contact shadows** use independent resource budgets.
Neither is ray tracing. Lens flares add optical glints at actual bright HDR lamp
locations, depth-occluded by solid scene geometry; TV labels and UI are drawn
afterward. Lens flares do not add diffuse lighting or material reflection detail.

### Local reflections

The implementation uses one reusable 256px HDR cube capture at world position
`[0, 1.6, 0]`, above the table, and prefilters it with a PMREM generator. It
assigns the completed map to selected wood, brass and dice materials; other
materials keep the casino environment, and the backdrop remains unchanged.
A 256px cube is a low-frequency reflection source, sufficient for
the selected rough wood finish; it is not accurate mirror geometry. One probe
cannot provide exact near-field parallax across the entire table.

Update when the settled physical layout or environment changes, not because the
camera makes a dolly. Capture only after 600 ms of safe stationary play; retain
the last valid probe during throws, prepared-bet movement and payouts. Avoid a
six-view burst every frame. The staged capture renders one face per update into
an inactive cube, then swaps a complete prefiltered result atomically. The
measured isolated proof is above; small textures still require six geometry
traversals, so larger populated-table benchmarks remain useful.

Three's r180 CubeCamera implementation renders its six child cameras, restores
the previous render target and marks the cube for PMREM updating. The official
[CubeCamera example](https://threejs.org/docs/pages/CubeCamera.html) also hides
the reflective subject while capturing. The r180
[source](https://github.com/mrdoob/three.js/blob/r180/src/cameras/CubeCamera.js)
is the compatibility reference for a staged implementation. The
[PMREM API](https://threejs.org/docs/pages/PMREMGenerator.html) supplies roughness
filtering and separate disposal of returned targets.

Project-specific requirements:

- The board samples its vector ink in **main-camera screen space**. Rendering
  the board unchanged into a cube face samples the wrong print. Either supply a
  probe-only ordinary world-UV board material or render and bind ink for each
  face, then restore the main-camera ink. A small print fallback is acceptable
  inside a blurred reflection; it must never replace the main native print.
- Hide native HUD/labels and prepared-bet ghosts. Hide or exclude probe-consuming
  reflective surfaces to prevent feedback. Retain the finite casino shell.
- Restore visibility, target, viewport/scissor, shadow-update flag, environment
  and tone-mapping state in a finally block. Do not regenerate key-light shadows
  six times during a capture.
- A local cube uses its own orientation. Do not inherit the panorama's
  `scene.environmentRotation` accidentally; explicit material `envMapRotation`
  exists in r180. Material cache sharing must remain intact.
- On disable/context replacement, restore original environment maps and dispose
  cube, filtered target and staging allocations. No off-state recurring capture.

The maximum implemented face size is 256px. With two filtered output buffers,
workspace, cube/depth and probe-only print, the controller estimates 33.2 MiB of
incremental texture storage after reuse is established. This is not a driver
allocation measurement. No 512px option is exposed. Off disposes all owned
targets and restores original material environment maps and rotations.

### Contact shadows

Existing direct-light shadows already update only when pieces move. The optional
mode increases the directional shadow map from 2048px to at most 4096px, bounded
by the device limit, with bias `-0.00006` and normal bias `0.006` instead of the
baseline `-0.0002`/`0.02`. This improves the contact footprint without adding a
screen-space AO pass. Switching on waits for safe stationary play. The original
shadow map is retained; switching off disposes the optional map and restores
the original map, dimensions and biases, requesting a fresh shadow update.

Memory is material: r180 packs PCF depth into an RGBA render target with a depth
attachment. A 4096px map can require approximately 128 MiB (64 MiB color plus a
typical 64 MiB depth attachment), in addition to the retained 2048px baseline.
These are format-based estimates, not queried driver allocations. Judge contact
clarity, corner acne, update spikes and memory together on the target device.

### Further contact-AO research, not enabled

If additional contact AO is needed, render opaque geometry depth/normals at a
bounded resolution, sample a short world-space radius around contact, and use an
edge-aware blur. Exclude the environment, UI, transparent dice and ghost chips
from the occluder buffer. The actual instanced transforms must participate.
Start with a 960×540 maximum, 8–12 samples and roughly 0.02–0.08 world-unit
radius; these are proposed study values, not production choices.

Apply AO to physical **indirect lighting**, including the board's native pass,
instead of multiplying the final TV canvas. That preserves bright ink, direct
light, UI clarity and the existing linear-HDR/output transform. Sample AO using
the current destination viewport in both scaled and native ground passes.

Three's [SSAOPass](https://threejs.org/docs/pages/SSAOPass.html) is a useful
reference; its stock effect renders a geometry-normal/depth buffer, an AO
buffer and a blur buffer. In r180 these use half-float color targets, so a
blind native-4K chain is expensive. The
[r180 source](https://github.com/mrdoob/three.js/blob/r180/examples/jsm/postprocessing/SSAOPass.js)
also shows why custom shader normals are not automatically reproduced by an
override normal material. Contact AO should use geometric contact rather than
exaggerated felt normal-map relief.

Planning cap: 16MiB incremental AO resources and sub-2ms GPU time at the bounded
size, to be measured at both 1080p and native 4K output. Disable allocations and
passes entirely when off. Avoid temporal accumulation until camera/physics
motion rejection is proven; otherwise moving chips can leave dark trails.

Screen-space reflections are another raster technique, not path tracing.
Three's [SSRPass](https://threejs.org/docs/pages/SSRPass.html) permits selective
surfaces and reduced resolution. Its missing offscreen information and
additional buffers make a cached local probe a better first study for this
game's moving close-up cameras.

## Actual path-traced photo feasibility

The current upstream pathtracer main branch uses WebGPU and declares Three
>=0.187; it is not a compatible drop-in upgrade for this r180 game. See its
[current package](https://github.com/gkjohnson/three-gpu-pathtracer/blob/main/package.json).
A pinned WebGL candidate exists: the
[v0.0.24 package](https://github.com/gkjohnson/three-gpu-pathtracer/blob/v0.0.24/package.json)
declares Three >=0.180, and its
[versioned README](https://github.com/gkjohnson/three-gpu-pathtracer/blob/v0.0.24/README.md)
documents progressive WebGL2 rendering and tiled samples. Compatibility of the
peer range alone is not a successful integration test.

A photo implementation should take a separate immutable scene snapshot, let
the live room continue, and progressively accumulate a stationary image. A
cancelable 1080p preview before a 4K export is a reasonable experiment; time to
convergence is unknown until tested on the intended devices. Moving a camera,
dice or chips resets accumulation, so this is distinct from live 60FPS play.

The critical fidelity work is a photo-scene adapter:

- Expand visible chip instances with their actual matrices, colors and stable
  per-chip wear. The application's `instanceColor` contains packed patina
  parameters, not RGB tint; generic conversion cannot interpret it as color.
- Bake selected patina, directional scratches and procedural felt into ordinary
  PBR maps, or deliberately port those material calculations into the tracer.
  Its [material serializer](https://github.com/gkjohnson/three-gpu-pathtracer/blob/v0.0.24/src/uniforms/MaterialsTexture.js)
  reads known scalar/map properties, not our WebGL `onBeforeCompile` hooks.
- Preserve the dedicated chip-logo UV1 channel explicitly. The old serializer
  stores texture transforms but does not serialize our `texture.channel` choice;
  remap photo geometry/maps rather than silently using wear UV0 for engraving.
- Turn native screen-space board ink into world-space print data or actual
  opaque outlined print geometry in the snapshot. A screen-space main-camera
  texture cannot be evaluated along arbitrary reflected/refracted rays.
- Reconstruct actual lighting and preserve the HDR environment. Omit UI and add
  export labels only after rendering. Verify translucent dice and clearcoat.

Without these adaptations, a path-traced image could have nicer light while
losing the very logos, scuffs and felt the user requested. Do not offer a
misleading live “ray tracing” switch that merely enables reflections/AO, or
promise an identical photo before matched captures prove the adapter.

## Required evidence before shipping a live option

Capture identical camera/ledger scenes with the effect off/on at 1080p and 4K,
including a close chip stack, translucent dice, actual throw and payout. Record
GPU allocation, draw calls, warm frame time and update-frame spikes. Verify
native print/labels remain sharp at a low scene-resolution setting, reflections
show the correct board, and toggling/context recreation restores every shared
material with no leaks. No visual option may delay the room cooldown or alter
physics/results.

## Reproduce a warm populated-table benchmark

The isolated benchmark accepts `BENCH_EFFECTS=off|on`, defaulting to Off. On
sets all three manual wire preferences; it does not silently choose an Auto
effect setting. An automatically generated On label ends in `-effects-on` so it
cannot overwrite the ordinary baseline artifact.

```sh
BENCH_EFFECTS=off npm run benchmark
BENCH_EFFECTS=on BENCH_WIDTH=3840 BENCH_HEIGHT=2160 npm run benchmark
BENCH_EFFECTS=on BENCH_ROLL=1 BENCH_MS=10000 npm run benchmark
```

The defaults are 12 players, full models, native texture limits, native scene
resolution, antialiasing On and a 60 FPS cap. Requested and actual scene/UI
framebuffer dimensions are recorded and checked. Measurement starts only after
the requested effect switches are applied and a complete supported reflection
probe matches the current physical scene revision. Unsupported or inactive
requested effects fail the benchmark rather than producing a misleading On
score. Flares can truthfully have zero visible sources when no lamp is in view.

`effectsBefore` proves the current warm probe. `effectsAfter` separately reports
whether that probe still matches the scene: during a real throw or payout the
previous complete probe intentionally remains visible, so a stale-but-valid
cached map is allowed after measurement and identified as `currentProbe:false`.
`effectsWarmupMs` measures only the extra readiness wait after the benchmark's
fixed player/bet setup settle; it is **not** the total cold opt-in compilation
time. Cold costs are measured separately in the isolated probe proof above.
