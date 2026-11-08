# Board print review with Claude

Claude Desktop reviewed the actual outlined SVGs, camera poses, compositor and
chip sources in the existing “Craps board design directions” conversation. This
was a source/CPU design review; renderer results are verified separately by the
project's browser checks. The working report and exploratory exports remain in
`artifacts/board-resolution-claude/`.

## Why the old print softened

At a native 3840 × 2160 output, the old 8192-wide whole-board texture supplied
about twice the pixels needed at the betting overview. The close overhead and
low table shots instead stretched one source texel over roughly 3–6 screen
pixels. Increasing anisotropy did not solve that magnification. A 16K whole-table
texture would still undersample the nearest cameras; a sparse tile alternative
would introduce more memory, streaming and runtime rasterization work.

The earlier suspicion that the SVG's intrinsic 2048-wide dimensions caused a
2048-wide intermediate decode was tested separately. Chromium's actual 8K
drawImage result matched the explicitly resized SVG in the compared crop.

## Design constraints accepted from the review

- Resolve the outlined print at the display's pixel budget, independently of the
  material-texture cap and reduced scene resolution.
- Preserve SVG paint order, nested transforms, clipped shapes, holes and stroke
  widths. Do not render the semantic wagering-region rectangles as artwork.
- Preserve constant group opacity once per paint, including overlapping stroke
  joins. Treat source SVG's encoded sRGB blending explicitly; ordinary linear
  alpha blending changes semi-transparent brass substantially.
- Keep the actual original raster brand mark at its own source resolution. Its
  alpha and position in the painter order matter.
- Treat ink as part of the felt's albedo. It must receive actual table lighting,
  chip/dice shadows and physical occlusion, rather than floating above them.
- Remove the repetitive decorative diagonal hatch separately from the felt's
  material. Keep all betting labels, regions and authoritative coordinates.

Claude also recommended comparing real output pixels at low and native scene
ratios, both rulesets and both antialias settings, rather than relying on reported
texture dimensions. The final runtime and its verification are described in
[board design](board-design.md).

## Chip review

The dedicated full-medallion UV channel was consistent with the review: retain
the original wear coordinates, preserve sharp source edges separately from the
engraving bevel, and test both faces and geometry variants under the lower
surface-texture cap. The resulting asset and pixel checks are recorded in
[chips](chips.md).
