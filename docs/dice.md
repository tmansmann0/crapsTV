# Casino dice assets

`public/assets/dice.glb` is an original Blender mesh, built by `scripts/build-dice.py`. The editable source is `assets/source/dice.blend`. The file contains only the die body and its 21 cream painted pip bowls; no table, camera, lights, or preview props are exported.

## Shape and coordinates

The die is a one-unit cube centered at the origin, with a 0.045-unit machined bevel. Every pip is a **real Boolean-cut spherical cavity**, approximately 0.065 units deep. The cream paint is a separate concave cap starting 0.032 units below the face, leaving a visible resin lip and recess; the pips are not flat disks or spheres placed on top.

The GLB uses glTF Y-up coordinates:

| Outward face normal | Number |
| --- | --- |
| +Y | 1 |
| −Y | 6 |
| +Z | 2 |
| −Z | 5 |
| +X | 3 |
| −X | 4 |

Opposite faces sum to seven. Blender itself uses Z-up; the export performs the coordinate conversion. At runtime, a scale near **0.22** makes the dice appropriately small against the twelve-unit table.

## Materials and variants

The object and material names are stable:

- **`DiceBody`**: neutral acrylic/resin; replace only this material's color with the shooter's red, green, or blue selection. Use `MeshPhysicalMaterial` for transparent variants with an IOR around 1.49, transmission, thickness, and attenuation; keep an opaque option. The GLB itself is intentionally neutral and opaque.
- **`DicePips`**: cream inset paint; keep opaque and retain its color when recoloring the body.

`dice-wear-1.png`, `dice-wear-2.png`, and `dice-wear-3.png` have always supplied seeded hairline scuffs. Their original relief and roughness contrast were very low, and the clearcoat remained pristine, so these marks were difficult to see. The updated 512×512 maps add fine handling scratches and three corresponding `dice-roughness-1.png` … `dice-roughness-3.png` maps. Each die consistently selects the matching normal/roughness pair. The legacy `dice-roughness.png` aliases variant 1 for existing tools.

External maps use `THREE.NoColorSpace` and `flipY = false`. The runtime applies 0.42 body normal strength to solid dice and 0.30 to translucent dice, plus a gentler 0.26 normal on the clearcoat itself. Polished resin remains around 0.24 roughness, with localized scratches rising toward 0.45. Only `DiceBody` receives wear; the real recessed pip geometry and cream inset paint are unchanged. All three colors, transmission, and software-renderer fallback retain their previous behavior.

The maps-only baker `python3 scripts/build-surface-maps.py` regenerates these maps and 1K felt normal/roughness maps without rebuilding models. It requires NumPy and Pillow, records hashes/statistics in `surface-detail-metadata.json`, and shares deterministic map functions with both Blender build scripts. The felt uses overlapping short fibres and gentle matted nap rather than a regular weave; the .46-unit physical tile and board coordinates remain fixed. Relief and grazing sheen affect lighting only, with no geometry displacement or printed-art distortion.

## Rebuild and verify

```sh
blender --background --python scripts/build-dice.py
```

The build uses Blender 4.5 LTS with no add-ons, network calls, or downloaded assets. It writes the GLB, three normal maps, three matching roughness maps plus a legacy alias, a metadata JSON, an editable `.blend`, and `dice-preview.png`. The preview shows the three opaque colorways under product lighting; colors are applied only after the neutral GLB and source are saved.

The script asserts fewer than 20,000 triangles per die. `dice-metadata.json` records the exact count and physical recess dimensions. The original geometry and procedural maps are created for this project and inherit its repository license.

Validation: the final die has **16,280 triangles**. Direct GLB accessor inspection confirmed all six face values, and the close-up preview was visually checked for recessed paint and clean cavity surfaces.

## Felt friction and settling

The authority uses a corrected contact-manifold friction budget. Cannon 0.20's averaged-friction path swapped body-local contact arms for plane contacts, making a flat die drift sideways depending on its position on the table. The project retains the original contact anchors and divides the friction force budget among those contacts, so the multi-sided puck remains movable without multiplying its friction.

A controlled die launched flat at one scene-unit per second from X=3, Z=1 previously traveled 0.849 units over five seconds and kept drifting sideways. With the correction it travels about 0.048 units, sleeps after 0.542 seconds, and remains still after one second. Regression tests also compare translated floor contacts and real throws. Launch randomness, restitution, damping, and the recorded physical resting faces are unchanged; playback never rotates a die to a selected result. Current hosts advertise physics version 4 so older running processes can be identified.

Physics protocol 5 uses the same recorded-dice authority with the new imperfect chip piles. Wager cylinders conservatively enclose the actual tilted chips, including their small lateral offsets and supported stack heights. Visual contact support and screen-space label exclusions use those same physical extents; the changed pile envelopes require a fresh local host process. Dice still retain their exact recorded resting orientations after landing.
