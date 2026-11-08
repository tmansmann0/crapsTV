import test from "node:test";
import assert from "node:assert/strict";
import { measureStartupDuration } from "./helpers/startup-duration.mjs";

const start = {
  at: 5986.7,
  elapsed: 0,
  uploadPausedMs: 0,
  ready: "true",
  demo: "true",
  intro: "true",
  phase: "materials",
};
const active = {
  ...start,
  at: 35052.3,
  elapsed: 28932.2,
  uploadPausedMs: 133.4,
  phase: "result",
};
const end = {
  ...active,
  at: 37652.1,
  elapsed: 30000,
  demo: "false",
  intro: "false",
  phase: "live",
};

test("slow terminal RAF is measured separately from 30s content using its actual crossing bracket", () => {
  const measured = measureStartupDuration([start, active, end]);
  assert.equal(measured.contentDuration, 30000);
  assert(Math.abs(measured.terminalOvershootMs - 1532) < 0.1);
  assert(Math.abs(measured.completionFrameGapMs - 2599.8) < 0.1);
});

test("deadline proof rejects early completion, late eligible frames and unaccounted clock jumps", () => {
  assert.throws(
    () => measureStartupDuration([start, active, { ...end, at: 36000 }]),
    /before its deadline/,
  );
  assert.throws(
    () =>
      measureStartupDuration([
        start,
        { ...active, at: 36500, elapsed: 30379.9 },
        end,
      ]),
    /first eligible RAF/,
  );
  assert.throws(
    () => measureStartupDuration([start, { ...active, elapsed: 28000 }, end]),
    /agrees with actual RAF/,
  );
});
