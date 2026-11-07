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

`dice-wear-1.png`, `dice-wear-2.png`, and `dice-wear-3.png` are original 512×512 tangent-space normal maps with different subtle hairline scuff patterns. `dice-roughness.png` is the matching low-contrast grayscale resin roughness map. These are real texture files generated deterministically from seeded noise and small scratch paths. The first normal map and roughness map are embedded in the GLB; the other maps can be selected independently for the two dice.

External normal and roughness textures should use `THREE.NoColorSpace` and `flipY = false` to match glTF UVs. A normal scale near 0.32 keeps the wear quiet. The body has proper UVs; don't apply the wear normal to the painted pips. The GLB includes a clear-coat material extension; use the imported physical material or preserve its clear-coat settings when replacing it.

## Rebuild and verify

```sh
blender --background --python scripts/build-dice.py
```

The build uses Blender 4.5 LTS with no add-ons, network calls, or downloaded assets. It writes the GLB, three normal maps, roughness map, a metadata JSON, an editable `.blend`, and `dice-preview.png`. The preview shows the three opaque colorways under product lighting; colors are applied only after the neutral GLB and source are saved.

The script asserts fewer than 20,000 triangles per die. `dice-metadata.json` records the exact count and physical recess dimensions. The original geometry and procedural maps are created for this project and inherit its repository license.

Validation: the final die has **16,280 triangles**. Direct GLB accessor inspection confirmed all six face values, and the close-up preview was visually checked for recessed paint and clean cavity surfaces.
