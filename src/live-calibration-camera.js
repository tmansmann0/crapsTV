import { calibrationCanHold } from "./startup-calibration.js";

/** Local camera ownership only; room timestamps and physics are never changed. */
export function retainLiveCalibrationCamera(hold, { now, roomNow, state }) {
  if (!hold) return false;
  if (
    state?.rolling ||
    state?.aim?.active ||
    hold.throwId !== (state?.throw?.id || null)
  )
    return false;
  // A fast first recovery frame does not prove a later static frame appeared.
  // Keep this shot through a second stalled RAF, until the renderer confirms
  // it actually presented a frame at least150ms after the quality switch.
  if (hold.switchedAt != null && !hold.recoveryPresented) return true;
  if (
    !(hold.recoveryUntil && now < hold.recoveryUntil) &&
    !calibrationCanHold(state, roomNow, 0)
  )
    return false;
  // A coarse RAF may cross the camera lead and nominal expiry together.
  // An unvisited switch can still happen in this safe, stationary shot.
  return hold.switchedAt == null || now < hold.endAt;
}

/** Call only after the actual world draw, never from a skipped/throttled RAF. */
export function markLiveCalibrationPresented(hold, now) {
  if (hold?.switchedAt != null && now - hold.switchedAt >= 150)
    hold.recoveryPresented = true;
}
