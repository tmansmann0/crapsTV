export const DEFAULT_ROLL_COOLDOWN_SECONDS = 15;
export const MAX_ROLL_COOLDOWN_SECONDS = 60;
export const DEFAULT_BOT_ROLL_DELAY_SECONDS = 5;
export const MAX_BOT_ROLL_DELAY_SECONDS = 60;

function localDeadline(state, deadline) {
  if (
    state?.status !== "playing" ||
    state.rolling ||
    !Number.isFinite(deadline)
  )
    return null;
  const offset = Number.isFinite(state.clockOffsetMs) ? state.clockOffsetMs : 0;
  return deadline - offset;
}

export function bettingDeadline(state) {
  return localDeadline(state, state?.nextRollAt);
}

export function botRollDeadline(state) {
  if (
    !state?.players?.some(
      (player) => player.id === state.shooterId && !player.left && player.bot,
    )
  )
    return null;
  return localDeadline(state, state.botRollAt);
}

export function secondsUntil(deadline, now = Date.now()) {
  return deadline === null
    ? 0
    : Math.max(0, Math.ceil((deadline - now) / 1000));
}

/** UI only: the room authority independently checks its own clock. */
export function bettingSecondsRemaining(state, now) {
  return secondsUntil(bettingDeadline(state), now);
}

/** Informational automatic-bot timer; never disables a human throw. */
export function botRollSecondsRemaining(state, now) {
  return secondsUntil(botRollDeadline(state), now);
}
