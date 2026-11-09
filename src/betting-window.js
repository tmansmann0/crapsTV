export const DEFAULT_ROLL_COOLDOWN_SECONDS = 10;
export const MAX_ROLL_COOLDOWN_SECONDS = 60;
export const DEFAULT_BOT_ROLL_DELAY_SECONDS = 5;
export const MAX_BOT_ROLL_DELAY_SECONDS = 60;

/** UI only: the room authority independently checks its own clock. */
export function bettingSecondsRemaining(state, now = Date.now()) {
  if (state?.status !== "playing" || state.rolling) return 0;
  const deadline = state.nextRollAt;
  if (!Number.isFinite(deadline)) return 0;
  const offset = Number.isFinite(state.clockOffsetMs) ? state.clockOffsetMs : 0;
  return Math.max(0, Math.ceil((deadline - now - offset) / 1000));
}

/** Informational automatic-bot timer; never disables a human/host throw. */
export function botRollSecondsRemaining(state, now = Date.now()) {
  if (state?.status !== "playing" || state.rolling) return 0;
  if (
    !state.players?.some(
      (player) => player.id === state.shooterId && !player.left && player.bot,
    )
  )
    return 0;
  if (!Number.isFinite(state.botRollAt)) return 0;
  const offset = Number.isFinite(state.clockOffsetMs) ? state.clockOffsetMs : 0;
  return Math.max(0, Math.ceil((state.botRollAt - now - offset) / 1000));
}
