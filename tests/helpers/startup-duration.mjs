import assert from "node:assert/strict";

// RAF timestamps and accumulated waits arrive as decimal milliseconds. Do
// the deadline arithmetic in nanoseconds so binary rounding cannot turn an
// exact crossing into an early completion.
const nanosecondsPerMillisecond = 1_000_000;
const toNanoseconds = (ms) => Math.round(ms * nanosecondsPerMillisecond);
const toMilliseconds = (ns) => ns / nanosecondsPerMillisecond;

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
    deadline = toNanoseconds(duration),
    origin = toNanoseconds(started.at) - toNanoseconds(started.elapsed),
    initialPause = toNanoseconds(started.uploadPausedMs || 0);
  const actualElapsed = (s) => toNanoseconds(s.at) - origin;
  const pausedElapsed = (s) =>
    toNanoseconds(s.uploadPausedMs || 0) - initialPause;
  const rawElapsed = (s) => actualElapsed(s) - pausedElapsed(s);
  for (const sample of samples.slice(first, last)) {
    assert(
      Math.abs(rawElapsed(sample) - toNanoseconds(sample.elapsed)) <
        toNanoseconds(0.1),
      "recorded content clock agrees with actual RAF time minus accounted waits",
    );
  }
  assert(
    rawElapsed(previous) < deadline,
    "opening finishes on first eligible RAF",
  );
  assert(
    rawElapsed(ended) >= deadline,
    "opening cannot end before its deadline",
  );
  assert.equal(
    ended.elapsed,
    duration,
    "final content frame reaches the endpoint",
  );
  const rawContentDuration = rawElapsed(ended),
    terminalOvershoot = rawContentDuration - deadline,
    completionFrameGap = toNanoseconds(ended.at) - toNanoseconds(previous.at);
  assert(
    terminalOvershoot <= completionFrameGap + toNanoseconds(0.1),
    "only the measured terminal frame gap can extend completion",
  );
  return {
    actualDuration: toMilliseconds(actualElapsed(ended)),
    uploadPausedMs: toMilliseconds(pausedElapsed(ended)),
    contentDuration: toMilliseconds(rawContentDuration - terminalOvershoot),
    rawContentDuration: toMilliseconds(rawContentDuration),
    terminalOvershootMs: toMilliseconds(terminalOvershoot),
    completionFrameGapMs: toMilliseconds(completionFrameGap),
  };
}
