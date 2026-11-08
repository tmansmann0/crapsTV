# Rendered casino HDR environment

`public/assets/casino-room.exr` is a **rendered, scene-linear, high-dynamic-range environment**, not an LDR image placed in an HDR container. Blender Cycles traces the light transport through a complete original room. Actual luminous surfaces, area lights, wall and floor materials, furniture, metalwork, and architectural geometry create the lighting and reflection information.

`public/assets/casino-room-preview.png` is the separate AgX display-transformed preview. Do not load that preview as the lighting source.

## Reproduce

Requires Blender 4.5 LTS or newer; no external assets, add-ons, image textures, or fonts are needed.

```sh
blender --background --python scripts/build-environment.py
```

The script requests Metal rendering when available and otherwise uses CPU Cycles. Rendering uses 32 adaptive samples with denoising. The final EXR is 4096 × 2048, 16-bit half-float RGB with ZIP compression. Its pixels are saved before any display transform. The PNG preview uses AgX Medium High Contrast with exposure zero. The subdued carpet pattern uses fine, low-contrast brass-brown seams against a burgundy base.

## Geometry and placement

- All scene dimensions are meters. Blender uses Z up.
- The camera is at `(0, 0, 1.6)`, looking horizontally toward `+Y`; the center of the panorama faces the back bar. The panoramic seam is behind the camera at the lounge side.
- The room is 24m wide (`X`) by 18m deep (`Y`) with a 5.5m ceiling.
- The central space is deliberately clear for the live craps table. Surrounding tables are roughly 7m to the sides, and the bar is about 7m in front.
- The floor lies at Z=0 in the original room. In a Three.js Y-up scene, the equivalent floor is world Y=0. The runtime projects the panorama onto a finite shell to approximate translational parallax; the table, dice, and chips provide the actual foreground geometry and occlusion.
- Original modeling includes walnut and ivory panels, brass pilasters, six opal chandeliers, warm sconces, coffered ceiling, carpet, three lounge settings, four additional game tables with chairs, and a stocked bar.

## Three.js use

Load `casino-room.exr` with `EXRLoader`, assign `EquirectangularReflectionMapping`, and use it for the inward-facing finite backdrop sphere and the PMREM input for `scene.environment`. EXRLoader's default color space for this scene-linear source should remain linear; do not tag it as sRGB. Keep renderer tone mapping enabled for the visible HDR background and lit objects. If rotating the background for composition, apply the same orientation to the lighting environment.

The current app projects this 360-degree environment onto an inward-facing sphere of radius 42, centered at world Y=2.2. This intentionally approximates a 3D room: camera dolly/zoom changes the visible backdrop scale. PMREM lighting remains derived from the original linear HDR. It is not a fully modeled room and does not provide furniture collisions; the table and dice have real foreground geometry and colliders. The procedural `casino-studio.hdr` and AI-generated `casino-panorama.png` remain separate earlier alternatives; neither was used to make this file.

## Verification

The completed 4096 × 2048 room panorama was visually inspected for framing, floor continuity, ceiling coverage, readable furniture, and light exposure. The final EXR is **21,199,469 bytes** (20.2 MiB). Reopening its pixel data in Blender confirms scene-linear component values from **0.00000262 to 14.5547**, with **196,451 pixels above 1.0** in at least one RGB channel. These over-white values establish that the saved environment retains HDR radiance rather than only display-referred color. The PNG preview is **8,214,108 bytes** (7.8 MiB) and remains a separate, tone-mapped viewing artifact. This 4K revision retains the original geometry and lighting while narrowing and darkening the carpet seams.

## Provenance

All geometry, materials, lighting, and the build script are original crapsTV project work. The asset uses no third-party stock, source imagery, or downloaded 3D models and follows the repository's asset license.
