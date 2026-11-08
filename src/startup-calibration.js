const clamp = (n, low, high) => Math.max(low, Math.min(high, n));
// Live retests request a probe at these ages, then wait for a safe result hold.
export const STARTUP_PROBE_AT = [0, 6500, 14000, 22500];
export const CALIBRATION_CAMERA_LEAD_MS = 300;
export const CALIBRATION_HOLD_MS = 1000;

/** No automatic reallocations while a player aims, dice move, or chips pay out. */
export function calibrationCanHold(
  state,
  now,
  minimumClearMs = CALIBRATION_HOLD_MS,
) {
  if (state?.rolling || state?.aim?.active) return false;
  const flight = state?.throw;
  if (flight && now < (flight.settledAt ?? flight.startAt + flight.duration))
    return false;
  const presentation = state?.lastRoll?.presentation;
  if (presentation && now >= presentation.startAt && now < presentation.endAt)
    return false;
  // Leave the full camera lead before an upcoming payout camera/animation.
  if (
    presentation &&
    now < presentation.startAt &&
    presentation.startAt - now < minimumClearMs
  )
    return false;
  return true;
}

/** Ramp only automatic preferences; resolveGraphics still applies each override. */
export function startupCandidates(recommended, { software = false } = {}) {
  if (software) return [0, 1, 2].map(() => ({ ...recommended }));
  return [0.65, 0.82, 1].map((scale, index) => ({
    ...recommended,
    fps: 60,
    resolutionScale: recommended.resolutionScale * scale,
    textureLimit: Math.min(
      recommended.textureLimit,
      index ? 2048 * index : 1024,
    ),
    modelDetail: index ? recommended.modelDetail : "optimized",
  }));
}
export function probeStatistics(samples = []) {
  const valid = samples
    .filter((n) => Number.isFinite(n) && n >= 1 && n <= 2000)
    .sort((a, b) => a - b);
  if (valid.length < 8) return null;
  return { count: valid.length, p80: valid[Math.ceil(valid.length * 0.8) - 1] };
}
export function selectStartupProfile(
  candidates,
  reports,
  { requestedFps = "auto", software = false } = {},
) {
  if (software) return { ...candidates[0] };
  const target = requestedFps === "auto" ? 60 : requestedFps;
  const threshold = target === 24 ? 53 : target === 30 ? 37 : 20;
  for (let index = candidates.length - 1; index >= 0; index--) {
    const stats = probeStatistics(reports[index]);
    if (stats && stats.p80 <= threshold)
      return { ...candidates[index], fps: target };
  }
  const measured = reports.map(probeStatistics);
  const first = measured.findIndex(Boolean);
  if (first < 0) return { ...candidates[0] };
  const p80 = measured[first].p80;
  return {
    ...candidates[first],
    fps: p80 <= 38 ? 30 : 24,
    resolutionScale:
      candidates[first].resolutionScale * clamp(33 / p80, 0.6, 1),
  };
}
