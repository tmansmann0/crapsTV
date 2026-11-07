# ON/OFF puck asset

`public/assets/puck.glb` is an original two-sided casino puck, with one satin-polymer PBR material and a baked 1024 × 1024 text atlas. The geometry and geometric letterforms are created by `scripts/build-puck.py`; no third-party artwork or font is used. No additional third-party attribution is required.

- Centered origin; glTF Y-up.
- Radius 0.2, diameter 0.4, height 0.085.
- Identity orientation: white **ON** face toward +Y.
- Rotation by π about X: black **OFF** face toward +Y, lettering upright from the same viewing direction.
- Beveled perimeter; side depth divided equally into white and black halves.
- 1,340 triangles, one material, 98,980-byte GLB at initial generation.

The collider may use the same centered cylinder dimensions. Apply the full authoritative puck position/quaternion to the model; no model-space translation or extra face correction is required. `assets/source/puck.blend` remains in the identity/ON orientation and embeds its atlas for editing.

Regenerate with the installed Blender runtime:

```sh
blender --background --python scripts/build-puck.py
```

Outputs include `puck.glb`, `puck-atlas.png`, `puck-stats.json` and two Blender previews (`puck-on-preview.png`, `puck-off-preview.png`). The script checks the triangle budget before export. An independent Three.js import measured 0.400000006 × 0.085000001 × 0.400000006, with center [0, 0, 0], 1,340 triangles and one material. The imported ON/OFF faces were visually verified; proof is in `artifacts/puck-three-preview.png` and `artifacts/puck-three-stats.json`.
