/**
 * The isolated opening cannot seek past an unvisited calibration shot when a
 * slow RAF skips its entire time window. Stop at the shot's start, then allow
 * its camera lead before stopping at the switch until the caller applies it.
 * Returned pauses belong to the demo clock only, never a room/game deadline.
 */
export function createStartupClock(holds, motionWindows = []) {
  const checkpoints = holds.map(({ probe, startAt, switchAt }) => ({
    probe,
    startAt,
    switchAt,
  }));
  let entered = null,
    recovery = null,
    lastElapsed = 0;
  const checkpointClock = {
    advance({ elapsed, now, completedProbe }) {
      if (recovery && completedProbe >= recovery.probe) {
        // A quick first post-upload RAF must not release the result: a later
        // RAF can still stall past the entire static window. Present at least
        // one recovery frame 150ms after the switch before releasing it on
        // the following frame. Only discarded content time becomes a pause.
        const adjusted = Math.min(elapsed, recovery.switchAt + 150);
        if (now - recovery.at >= 150) recovery = null;
        return { elapsed: adjusted, pausedMs: Math.max(0, elapsed - adjusted) };
      }
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
      if (adjusted >= next.switchAt && !recovery)
        recovery = { probe: next.probe, switchAt: next.switchAt, at: now };
      return { elapsed: adjusted, pausedMs: Math.max(0, elapsed - adjusted) };
    },
  };
  return {
    advance({ elapsed, now, completedProbe }) {
      // First-use shader work can stall even before a quality switch. Never
      // jump over a throw or the UI fade: show its start, then advance motion
      // by at most 250ms per frame. This affects only the isolated demo clock.
      const motion = motionWindows.find(
        ({ startAt, endAt }) => lastElapsed < endAt && elapsed >= startAt,
      );
      const visibleElapsed = motion
        ? Math.min(
            elapsed,
            lastElapsed < motion.startAt
              ? motion.startAt
              : Math.min(motion.endAt, lastElapsed + 250),
          )
        : elapsed;
      const result = checkpointClock.advance({
        elapsed: visibleElapsed,
        now,
        completedProbe,
      });
      lastElapsed = result.elapsed;
      return {
        elapsed: result.elapsed,
        pausedMs: Math.max(0, elapsed - result.elapsed),
      };
    },
  };
}
