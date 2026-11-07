# Graphics settings

Open the TV gear, then **Graphics**. Everything remains inside the 3D canvas. Admin phones have the same controls under **TV graphics**. Local TV choices persist in that browser; an explicit admin graphics update replaces them for that room without changing bets or dice.

| Setting | Choices | Effect |
| --- | --- | --- |
| Frame rate | Auto, 24, 30, 60 | Caps rendered frames without changing the shared physics timeline. |
| Antialiasing | Auto, On, Off | Controls native WebGL edge smoothing. Changing it rebuilds the graphics context while preserving the room and settings panel. |
| Resolution | Auto, 75%, 100%, 150%, 200% | Scales the native device-pixel drawing buffer. The panel reports the actual rendered width and height. |
| Model detail | Auto, Full, Optimized | Controls chip geometry. Full always uses the original detailed chips; Optimized always uses the smaller variant. Auto switches by projected size, with hysteresis. The table itself always uses the optimized, silhouette-preserving model. |
| Textures | Auto, 1K, 2K, Native | Caps each asset's longest image dimension. Native restores the original source up to GPU limits. Images are never upscaled, and HDR values remain HDR. |

These are texture dimensions, not video resolution. Most painted table/chip textures are at most 2K; the casino environment is 4K. Selecting Native cannot manufacture 4K detail from a 512px normal map or 2K felt image. UI text and join codes retain their own sharp canvas rendering.

## Automatic defaults and the intro

On boot, capability-based defaults limit excessive pixel density and choose lighter settings on low-memory or software-rendered devices. After the models and shaders are ready, a short in-scene intro measures frame intervals during a camera sweep. Reduced-motion preferences suppress camera travel, and hidden tabs pause measurement. The automatic profile can reduce resolution and choose a sustainable 24/30/60 target; explicit choices remain unchanged. Use **Retest automatic settings** to measure again.

The diagnostic uses frame intervals before the requested frame limiter. Otherwise a deliberate 24 FPS preference would be mistaken for a slow GPU. Rendered FPS, actual resolution and texture cap are shown in the panel. This is a short practical calibration, not a guarantee that every later scene or device will sustain its target.

## Performance checklist review

The requested [Three.js Performance Checklist](https://marceloretana.com/checklist/threejs-performance-checklist) was reviewed against this scene. The implementation uses shared/instanced chip geometry, material batches, an indexed seven-mesh table, bounded texture sizes, cached static shadows, correct culling bounds, and explicit GPU-resource cleanup. The renderer avoids rebuilding stationary banks every frame. The table's optimization does not require switching between table LODs; optional chip detail is still useful because hundreds of distant chips otherwise dominate triangle counts.

Progressive pop-in was deliberately avoided: the table appears after critical models/textures/shaders are ready, matching the requested stable scene. KTX2 and mesh compression remain possible loading optimizations, but are not required for the measured frame-rate improvement. Deterministic disposal is used rather than relying on garbage-collection finalizers for GPU cleanup.
