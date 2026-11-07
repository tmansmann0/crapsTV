/**
 * The isolated opening cannot seek past an unvisited calibration shot when a
 * slow RAF skips its entire time window. Stop at the shot's start, then allow
 * its camera lead before stopping at the switch until the caller applies it.
 * Returned pauses belong to the demo clock only, never a room/game deadline.
 */
export function createStartupClock(holds) {
  const checkpoints = holds.map(({ probe, startAt, switchAt }) => ({
    probe,
    startAt,
    switchAt,
  }));
  let entered = null;
  return {
    advance({ elapsed, now, completedProbe }) {
      const next = checkpoints.find(({ probe }) => probe > completedProbe);
      if (!next || elapsed < next.startAt) return { elapsed, pausedMs: 0 };
      if (entered?.probe !== next.probe) {
        entered = { probe: next.probe, at: now };
        return {
          elapsed: next.startAt,
          pausedMs: Math.max(0, elapsed - next.startAt),
        };
      }
      // Both content time and real visible time must supply the camera lead.
      // On a multi-second frame gap the next frame may switch, but it remains
      // on the same already-landed result instead of jumping into its payout.
      const limit = Math.min(
        next.switchAt,
        next.startAt + Math.max(0, now - entered.at),
      );
      const adjusted = Math.min(elapsed, limit);
      return { elapsed: adjusted, pausedMs: Math.max(0, elapsed - adjusted) };
    },
  };
}
