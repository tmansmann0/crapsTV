import assert from "node:assert/strict";

/** Verify a real RAF deadline crossing, including a slow terminal frame. */
export function measureStartupDuration(samples, duration = 30000) {
  const first = samples.findIndex(
    (s) => s.ready === "true" && s.demo === "true",
  );
  const last = samples.findIndex(
    (s, i) => i > first && s.phase === "live" && s.intro === "false",
  );
  assert(first >= 0 && last > first, "opening has start and completion frames");
  const started = samples[first],
    ended = samples[last],
    previous = samples[last - 1],
    initialPause = started.uploadPausedMs || 0;
  const rawElapsed = (s) =>
    s.at -
    started.at +
    started.elapsed -
    ((s.uploadPausedMs || 0) - initialPause);
  for (const sample of samples.slice(first, last)) {
    assert(
      Math.abs(rawElapsed(sample) - sample.elapsed) < 0.1,
      "recorded content clock agrees with actual RAF time minus accounted waits",
    );
  }
  assert(
    rawElapsed(previous) < duration,
    "opening finishes on first eligible RAF",
  );
  assert(
    rawElapsed(ended) >= duration,
    "opening cannot end before its deadline",
  );
  assert.equal(
    ended.elapsed,
    duration,
    "final content frame reaches the endpoint",
  );
  const actualDuration = ended.at - started.at + started.elapsed,
    uploadPausedMs = (ended.uploadPausedMs || 0) - initialPause,
    rawContentDuration = actualDuration - uploadPausedMs,
    terminalOvershootMs = rawContentDuration - duration,
    completionFrameGapMs = ended.at - previous.at;
  assert(
    terminalOvershootMs <= completionFrameGapMs + 0.1,
    "only the measured terminal frame gap can extend completion",
  );
  return {
    actualDuration,
    uploadPausedMs,
    contentDuration: rawContentDuration - terminalOvershootMs,
    rawContentDuration,
    terminalOvershootMs,
    completionFrameGapMs,
  };
}
