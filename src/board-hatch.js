/** Remove only the old repeated decorative hatch, never glyphs/region borders. */
export function stripBoardHatch(svg) {
  let removed = 0;
  const clean = svg.replace(/<path\b[^>]*\/>/g, (element) => {
    const colour = element.match(/\bstroke="rgb\(([^)]+)\)"/);
    const width = element.match(/\bstroke-width="([^"]+)"/);
    const path = element.match(/\bd="([^"]*)"/);
    if (
      !colour ||
      !width ||
      !path ||
      path[1].length < 10000 ||
      Number(width[1]) !== 0.45
    )
      return element;
    const rgb = colour[1]
      .split(/,\s*/)
      .map((c) => parseFloat(c) * (c.includes("%") ? 2.55 : 1));
    if (
      ![
        [14, 47, 35],
        [95, 22, 28],
      ].some((target) => target.every((n, i) => Math.abs(n - rgb[i]) < 0.1))
    )
      return element;
    removed++;
    return "";
  });
  return { svg: clean, removed };
}
