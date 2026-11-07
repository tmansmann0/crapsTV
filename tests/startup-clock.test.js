import test from "node:test";
import assert from "node:assert/strict";
import { createStartupClock } from "../src/startup-clock.js";

const holds = [
  { probe: 1, startAt: 9200, switchAt: 9500 },
  { probe: 2, startAt: 21600, switchAt: 21900 },
  { probe: 3, startAt: 28360, switchAt: 28660 },
];

test("a skipped result shot receives its full real camera lead before calibration", () => {
  const clock = createStartupClock(holds);
  assert.deepEqual(
    clock.advance({ elapsed: 8949.7, now: 14936.4, completedProbe: 0 }),
    { elapsed: 8949.7, pausedMs: 0 },
  );
  const entered = clock.advance({
    elapsed: 10966.3,
    now: 16953,
    completedProbe: 0,
  });
  assert.equal(entered.elapsed, 9200);
  assert(Math.abs(entered.pausedMs - 1766.3) < 1e-8);
  assert.deepEqual(
    clock.advance({ elapsed: 9400, now: 17153, completedProbe: 0 }),
    { elapsed: 9400, pausedMs: 0 },
  );
  assert.deepEqual(
    clock.advance({ elapsed: 11400, now: 19153, completedProbe: 0 }),
    { elapsed: 9500, pausedMs: 1900 },
  );
  assert.deepEqual(
    clock.advance({ elapsed: 9550, now: 19203, completedProbe: 1 }),
    { elapsed: 9550, pausedMs: 0 },
    "completed calibration releases its result for the existing recovery/payout timeline",
  );
});

test("replaying sparse CI frame gaps retains all three checkpoints and exactly accounts paused content", () => {
  // The failed software-renderer trace crossed result1 in one 2016.6ms RAF.
  // Later gaps also exceed entire hold windows; none may skip a calibration.
  const frames = [
    0, 766.7, 1766.6, 3883.3, 5000, 6200, 7300, 8949.7, 10966.3, 12016.3,
    14066.3, 16500, 18600, 20000, 22732.5, 23799.1, 24865.7, 25915.7, 26982.3,
    28015.6, 28882.2, 29065.6, 31665.4,
  ];
  // Continue the trace at its same slow cadence until all content finishes.
  for (let now = frames.at(-1) + 1066.6; now < 50000; now += 1066.6)
    frames.push(now);
  const clock = createStartupClock(holds),
    applied = [],
    entered = new Map();
  let paused = 0,
    completedProbe = 0,
    lastElapsed = 0,
    finished = false;
  for (const now of frames) {
    const result = clock.advance({
      elapsed: now - paused,
      now,
      completedProbe,
    });
    paused += result.pausedMs;
    assert(result.elapsed >= lastElapsed, "content never runs backwards");
    assert(Math.abs(now - paused - result.elapsed) < 1e-8);
    const next = holds.find(({ probe }) => probe > completedProbe);
    if (next && result.elapsed >= next.startAt) {
      if (!entered.has(next.probe)) entered.set(next.probe, now);
      assert(result.elapsed <= next.switchAt);
      if (result.elapsed >= next.switchAt) {
        assert(now - entered.get(next.probe) >= 300);
        applied.push(next.probe);
        completedProbe = next.probe;
      }
    }
    lastElapsed = result.elapsed;
    if (result.elapsed >= 30000) {
      assert.deepEqual(applied, [1, 2, 3]);
      finished = true;
      break;
    }
  }
  assert(finished);
  assert(
    paused > 1766,
    "scheduler waits are accounted rather than lost content",
  );
});

test("independent openings have fresh checkpoints and ordinary frames keep their clock", () => {
  const a = createStartupClock(holds),
    b = createStartupClock(holds);
  assert.equal(
    a.advance({ elapsed: 6000, now: 6000, completedProbe: 0 }).pausedMs,
    0,
  );
  a.advance({ elapsed: 12000, now: 12000, completedProbe: 0 });
  assert.deepEqual(
    b.advance({ elapsed: 12000, now: 18000, completedProbe: 0 }),
    { elapsed: 9200, pausedMs: 2800 },
  );
  assert.deepEqual(
    a.advance({ elapsed: 35000, now: 40000, completedProbe: 3 }),
    { elapsed: 35000, pausedMs: 0 },
    "after all checkpoints the existing duration/completion clock applies",
  );
});
