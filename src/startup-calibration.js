const clamp = (n, low, high) => Math.max(low, Math.min(high, n));
export const STARTUP_PROBE_AT = [0, 6500, 14000, 22500];

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
