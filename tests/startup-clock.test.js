import test from "node:test";
import assert from "node:assert/strict";
import { createStartupClock } from "../src/startup-clock.js";

const holds = [
  { probe: 1, startAt: 9200, switchAt: 9500 },
  { probe: 2, startAt: 21600, switchAt: 21900 },
  { probe: 3, startAt: 28360, switchAt: 28660 },
];

test("a cached intro presents its final UI fade before releasing the live table", () => {
  const clock = createStartupClock([], [{ startAt: 28200, endAt: 30000 }]);
  let paused = 0;
  const visible = [];
  // Failed CI trace jumped from 28449.7ms straight to the live UI.
  for (const now of [
    27449.7, 28449.7, 31000, 32000, 33000, 34000, 35000, 36000, 37000, 38000,
  ]) {
    const result = clock.advance({
      elapsed: now - paused,
      now,
      completedProbe: 3,
    });
    paused += result.pausedMs;
    visible.push(result.elapsed);
  }
  assert(visible.some((elapsed) => elapsed >= 29000 && elapsed < 30000));
  assert(
    visible.filter((elapsed) => elapsed >= 28200 && elapsed < 30000).length >=
      8,
  );
  assert(visible.at(-1) >= 30000);
});

test("first-use shader stalls cannot skip either physical intro throw", () => {
  const windows = [
    { startAt: 6200, endAt: 9200 },
    { startAt: 18600, endAt: 21600 },
  ];
  // Cached openings also need motion protection, without calibration holds.
  for (const checkpoints of [[], holds]) {
    const clock = createStartupClock(checkpoints, windows);
    let now = 0,
      paused = 0,
      completedProbe = 0;
    const visible = [];
    for (let i = 0; i < 150; i++) {
      now += 1100;
      const result = clock.advance({
        elapsed: now - paused,
        now,
        completedProbe,
      });
      paused += result.pausedMs;
      assert.equal(result.elapsed, now - paused);
      visible.push(result.elapsed);
      const hold = checkpoints.find(({ probe }) => probe > completedProbe);
      if (hold && result.elapsed >= hold.switchAt) completedProbe = hold.probe;
      if (result.elapsed >= 30000) break;
    }
    for (const { startAt, endAt } of windows) {
      const frames = visible.filter(
        (elapsed) => elapsed >= startAt && elapsed <= endAt,
      );
      assert.equal(frames[0], startAt, "launch is presented before advancing");
      assert(
        frames.length >= 13,
        "the throw has visible motion, not only a landed result",
      );
      for (let i = 1; i < frames.length; i++)
        assert(frames[i] - frames[i - 1] <= 250);
    }
    assert(visible.at(-1) >= 30000);
  }
});

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

test("a late second RAF cannot skip the post-switch static recovery frame", () => {
  for (const hold of holds) {
    const clock = createStartupClock([hold]),
      completedProbe = hold.probe - 1;
    clock.advance({ elapsed: hold.startAt, now: hold.startAt, completedProbe });
    assert.equal(
      clock.advance({
        elapsed: hold.switchAt,
        now: hold.switchAt,
        completedProbe,
      }).elapsed,
      hold.switchAt,
    );
    const quick = clock.advance({
      elapsed: hold.switchAt + 33,
      now: hold.switchAt + 33,
      completedProbe: hold.probe,
    });
    assert.deepEqual(quick, { elapsed: hold.switchAt + 33, pausedMs: 0 });
    const stalled = clock.advance({
      elapsed: hold.switchAt + 2033,
      now: hold.switchAt + 2033,
      completedProbe: hold.probe,
    });
    assert.deepEqual(
      stalled,
      {
        elapsed: hold.switchAt + 150,
        pausedMs: 1883,
      },
      "first frame beyond150ms stays on the same static camera/result",
    );
    assert.deepEqual(
      clock.advance({
        elapsed: hold.switchAt + 183,
        now: hold.switchAt + 2066,
        completedProbe: hold.probe,
      }),
      { elapsed: hold.switchAt + 183, pausedMs: 0 },
      "the following frame resumes content with the stall exactly accounted",
    );
  }
});
