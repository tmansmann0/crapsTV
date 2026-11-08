export const DEFAULT_ROLL_COOLDOWN_SECONDS = 10;
export const MAX_ROLL_COOLDOWN_SECONDS = 60;

/** UI only: the room authority independently checks its own clock. */
export function bettingSecondsRemaining(state, now = Date.now()) {
  if (state?.status !== "playing" || state.rolling) return 0;
  const deadline = state.nextRollAt;
  if (!Number.isFinite(deadline)) return 0;
  const offset = Number.isFinite(state.clockOffsetMs) ? state.clockOffsetMs : 0;
  return Math.max(0, Math.ceil((deadline - now - offset) / 1000));
}
