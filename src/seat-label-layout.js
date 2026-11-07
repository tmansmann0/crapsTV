const overlaps = (a, b, gap) =>
  a.x < b.x + b.width + gap &&
  a.x + a.width + gap > b.x &&
  a.y < b.y + b.height + gap &&
  a.y + a.height + gap > b.y;

/** Wide views favor the shooter's action; closeups reveal the local stakes. */
export function selectWagerLabels(candidates, shooterId) {
  const close = candidates.some((candidate) => candidate.pixels >= 64);
  return [...candidates]
    .filter((candidate) =>
      close ? candidate.pixels >= 40 : candidate.playerId === shooterId,
    )
    .sort(
      (a, b) =>
        Number(b.playerId === shooterId) - Number(a.playerId === shooterId) ||
        b.amount - a.amount,
    )
    .slice(0, close ? 12 : 4);
}

/** Keep readable seat labels near their anchors, outside other cards and HUD. */
export const DEFAULT_PLAYER_LABEL_SCALE = 2 / 3;

export function financialLabelMode(state, flows, impacts, allowed, wasVisible) {
  if (
    !allowed ||
    !state ||
    state.rolling ||
    state.status === "ended" ||
    impacts > 0 ||
    flows.some((flow) => flow.kind !== "wager")
  )
    return "hidden";
  if (flows.length) return wasVisible ? "frozen" : "hidden";
  return "live";
}

export function layoutSeatLabels(
  anchors,
  {
    width,
    height,
    exclusions = [],
    labelScale = DEFAULT_PLAYER_LABEL_SCALE,
    previous = [],
    motion = "stable",
  },
) {
  const viewportScale = height / 1080;
  const scale = viewportScale * labelScale;
  const gap = 8 * scale;
  const borderX = 80 * viewportScale,
    borderY = 60 * viewportScale;
  const occupied = exclusions.filter(
    (rect) => rect.width > 0 && rect.height > 0,
  );
  // Keep the existing arrangement through pixel jitter and small camera drift.
  // New layouts use a gap; reusing one needs only actual non-overlap, giving
  // the arrangement room to breathe before any card is moved to another slot.
  if (previous.length === anchors.length && previous.length) {
    const byId = new Map(previous.map((box) => [box.id, box]));
    const reused = anchors.map((anchor) => {
      const old = byId.get(anchor.id);
      if (!old) return null;
      const dx = anchor.x - old.anchorX,
        dy = anchor.y - old.anchorY;
      if (
        old.width !== (anchor.width ?? 220) * scale ||
        old.height !== (anchor.height ?? 90) * scale
      )
        return null;
      return {
        ...old,
        x: old.x + (Math.abs(dx) < 8 * viewportScale ? 0 : dx),
        y: old.y + (Math.abs(dy) < 8 * viewportScale ? 0 : dy),
        anchorX: Math.abs(dx) < 8 * viewportScale ? old.anchorX : anchor.x,
        anchorY: Math.abs(dy) < 8 * viewportScale ? old.anchorY : anchor.y,
      };
    });
    const crossedDeadband = anchors.some((anchor) => {
      const old = byId.get(anchor.id);
      return (
        !old ||
        Math.abs(anchor.x - old.anchorX) >= 8 * viewportScale ||
        Math.abs(anchor.y - old.anchorY) >= 8 * viewportScale
      );
    });
    if (
      (motion !== "smooth" || !crossedDeadband) &&
      reused.every(
        (box, i) =>
          box &&
          box.x >= borderX &&
          box.y >= borderY &&
          box.x + box.width <= width - borderX &&
          box.y + box.height <= height - borderY &&
          occupied.every((blocker) => !overlaps(box, blocker, 0)) &&
          reused
            .slice(0, i)
            .every((other) => other && !overlaps(box, other, 0)),
      )
    )
      return reused;
  }
  const placed = [];
  for (const anchor of anchors) {
    const cardWidth = (anchor.width ?? 220) * scale;
    const cardHeight = (anchor.height ?? 90) * scale;
    const clamp = (x, y) => ({
      x: Math.max(borderX, Math.min(width - borderX - cardWidth, x)),
      y: Math.max(borderY, Math.min(height - borderY - cardHeight, y)),
      width: cardWidth,
      height: cardHeight,
    });
    const preferred = clamp(
      anchor.x - cardWidth / 2,
      anchor.y - cardHeight / 2,
    );
    const candidates = [preferred];
    for (const blocker of occupied) {
      const left = blocker.x - cardWidth - gap,
        right = blocker.x + blocker.width + gap;
      const top = blocker.y - cardHeight - gap,
        bottom = blocker.y + blocker.height + gap;
      for (const [x, y] of [
        [left, preferred.y],
        [right, preferred.y],
        [preferred.x, top],
        [preferred.x, bottom],
        [left, top],
        [right, top],
        [left, bottom],
        [right, bottom],
      ])
        candidates.push(clamp(x, y));
    }
    candidates.sort(
      (a, b) =>
        Math.hypot(a.x - preferred.x, a.y - preferred.y) -
        Math.hypot(b.x - preferred.x, b.y - preferred.y),
    );
    let chosen = candidates.find((candidate) =>
      occupied.every((blocker) => !overlaps(candidate, blocker, gap)),
    );
    // A dense oblique view may hide all nearby candidates behind other cards.
    // Search the safe viewport, still taking the closest available position.
    if (!chosen) {
      const grid = [];
      for (
        let y = borderY;
        y + cardHeight <= height - borderY;
        y += cardHeight + gap
      )
        for (
          let x = borderX;
          x + cardWidth <= width - borderX;
          x += cardWidth + gap
        )
          grid.push(clamp(x, y));
      grid.sort(
        (a, b) =>
          Math.hypot(a.x - preferred.x, a.y - preferred.y) -
          Math.hypot(b.x - preferred.x, b.y - preferred.y),
      );
      chosen = grid.find((candidate) =>
        occupied.every((blocker) => !overlaps(candidate, blocker, gap)),
      );
    }
    if (!chosen) continue; // No readable space: never overlap another amount.
    occupied.push(chosen);
    placed.push({
      ...chosen,
      id: anchor.id,
      anchorX: anchor.x,
      anchorY: anchor.y,
    });
  }
  return placed;
}
