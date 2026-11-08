const mix = (a, b, t) => a + (b - a) * t;
const ease = (t) => t * t * (3 - 2 * t);
export const rectsOverlap = (a, b) =>
  a.x < b.x + b.width &&
  a.x + a.width > b.x &&
  a.y < b.y + b.height &&
  a.y + a.height > b.y;
export function sameLabelRect(a, b) {
  return (
    !!a &&
    !!b &&
    ["x", "y", "width", "height"].every(
      (key) => Math.abs(a[key] - b[key]) < 0.5,
    )
  );
}

/** Route labels through clear screen space; fade across blocked routes. */
export function createLabelTransition(
  from,
  to,
  now,
  { mode = "smooth", obstacles = [] } = {},
) {
  const target = { ...to };
  if (mode === "stable" || sameLabelRect(from, to))
    return { kind: "still", to: target, start: now, duration: 0 };
  if (!from || obstacles.some((rect) => rectsOverlap(from, rect)))
    return { kind: "appear", to: target, start: now, duration: 180 };
  const swept = {
    x: Math.min(from.x, to.x),
    y: Math.min(from.y, to.y),
    width:
      Math.max(from.x + from.width, to.x + to.width) - Math.min(from.x, to.x),
    height:
      Math.max(from.y + from.height, to.y + to.height) - Math.min(from.y, to.y),
  };
  return {
    kind: obstacles.some((rect) => rectsOverlap(swept, rect)) ? "fade" : "move",
    from: { ...from },
    to: target,
    start: now,
    duration: 260,
  };
}

export function sampleLabelTransition(track, now) {
  const progress = track.duration
    ? Math.max(0, Math.min(1, (now - track.start) / track.duration))
    : 1;
  const done = progress === 1;
  if (track.kind === "still") return { rect: track.to, opacity: 1, done: true };
  if (track.kind === "appear")
    return { rect: track.to, opacity: ease(progress), done };
  if (track.kind === "fade")
    return progress < 0.5
      ? { rect: track.from, opacity: 1 - ease(progress * 2), done }
      : { rect: track.to, opacity: ease((progress - 0.5) * 2), done };
  const t = ease(progress),
    rect = { ...track.to };
  for (const key of ["x", "y", "width", "height"])
    rect[key] = mix(track.from[key], track.to[key], t);
  return { rect, opacity: 1, done };
}
