import test from "node:test";
import assert from "node:assert/strict";
import { chipStackPose, chipPoseBounds } from "../src/chip-character.js";
import {
  createChipLandingPlan,
  sampleChipLanding,
  writeChipLandingPoses,
  prewarmChipLandingResponses,
  CHIP_LANDING_LIMITS as limits,
} from "../src/chip-landing.js";

function stack(count = 9, id = "bank:a", floorY = 0.615, diameter = 0.31) {
  return {
    id,
    floorY,
    chips: Array.from({ length: count }, (_, index) => {
      const pose = chipStackPose(id, index, { diameter, thicknessScale: 1.3 });
      pose.position[1] += floorY;
      return {
        id: `${id}:${index}`,
        denomination: index % 2 ? 500 : 2500,
        diameter,
        thicknessScale: 1.3,
        ...pose,
      };
    }),
  };
}
function planFor(chips = stack(), added = 1, startAt = 1000) {
  return createChipLandingPlan({
    stacks: [chips],
    addedIds: chips.chips.slice(-added).map((chip) => chip.id),
    startAt,
  });
}
const byId = (snapshot, id) => snapshot.poses.find((pose) => pose.id === id);

test("new chips start 15cm above their own stable slot and fall under gravity", () => {
  const source = stack(10),
    plan = planFor(source, 2);
  const [first, second] = source.chips.slice(-2);
  const initial = sampleChipLanding(plan, 1000);
  assert.equal(byId(initial, first.id).visible, true);
  assert.equal(
    byId(initial, second.id).visible,
    false,
    "queued chips do not float visibly over the stack",
  );
  assert(
    Math.abs(
      byId(initial, first.id).position[1] - first.position[1] - limits.drop,
    ) < 1e-12,
  );
  for (const elapsed of [30, 60, 100]) {
    const pose = byId(sampleChipLanding(plan, 1000 + elapsed), first.id);
    const expected =
      first.position[1] +
      limits.drop -
      0.5 * limits.gravity * (elapsed / 1000) ** 2;
    assert(Math.abs(pose.position[1] - expected) < 1e-12);
  }
  assert.equal(
    plan.tracks[0].events[1].startAt - plan.tracks[0].events[0].startAt,
    80,
  );
  assert.equal(byId(sampleChipLanding(plan, 1080), second.id).visible, true);
});

test("a simultaneous transfer cohort hands off to its exact stack poses without disappearing or restarting a fall", () => {
  const source = stack(19);
  const contactAt = 2000;
  const dropMs = Math.sqrt((2 * limits.drop) / limits.gravity) * 1000;
  const arrivals = source.chips.slice(-12);
  const plan = createChipLandingPlan({
    stacks: [source],
    addedIds: arrivals.map((chip) => chip.id),
    startAt: contactAt - dropMs,
    staggerMs: 0,
  });
  assert(plan.tracks[0].events.every((event) => event.contactAt === contactAt));
  const contact = sampleChipLanding(plan, contactAt);
  for (const chip of arrivals) {
    const pose = byId(contact, chip.id);
    assert.equal(pose.visible, true);
    assert.deepEqual(
      pose.position,
      chip.position,
      "the last flight pose is the first receiving-stack pose",
    );
  }
  let support = source.floorY;
  const from = source.chips.length - plan.tracks[0].rows.length;
  if (from) support = chipPoseBounds(source.chips[from - 1]).max[1];
  for (const pose of sampleChipLanding(plan, contactAt + 20).poses) {
    const base = source.chips.find((chip) => chip.id === pose.id);
    const bounds = chipPoseBounds({ ...base, ...pose });
    assert(bounds.min[1] >= support - 1e-10);
    support = bounds.max[1];
  }
});

test("confirmed cached Cannon contact nudges only the top three underlying chips", () => {
  const source = stack(12),
    plan = planFor(source),
    event = plan.tracks[0].events[0];
  assert.equal(event.kernel.contact, true);
  assert.equal(event.kernel.bodyCount, 4);
  assert.deepEqual(
    plan.chipIds,
    source.chips.slice(-4).map((chip) => chip.id),
  );
  for (const pose of sampleChipLanding(plan, event.contactAt - 1).poses.filter(
    (pose) => pose.id !== source.chips.at(-1).id,
  ))
    assert.deepEqual(
      pose.position,
      source.chips.find((chip) => chip.id === pose.id).position,
      "underlying chips wait for the actual incoming contact",
    );
  let greatestSlide = 0,
    greatestTilt = 0;
  for (let now = event.contactAt; now <= event.endAt; now += 4) {
    for (const pose of sampleChipLanding(plan, now).poses.slice(0, -1)) {
      const base = source.chips.find((chip) => chip.id === pose.id);
      greatestSlide = Math.max(
        greatestSlide,
        Math.hypot(
          pose.position[0] - base.position[0],
          pose.position[2] - base.position[2],
        ),
      );
      greatestTilt = Math.max(
        greatestTilt,
        Math.hypot(
          pose.rotation[0] - base.rotation[0],
          pose.rotation[2] - base.rotation[2],
        ),
      );
    }
  }
  assert(
    greatestSlide > 0.0003,
    "a solved contact produces a real small stack shuffle",
  );
  assert(
    greatestTilt > 0.0001,
    "contact torque produces a small controlled tip",
  );
  assert(greatestSlide <= limits.maxSlide + 1e-12);
  assert(greatestTilt <= Math.PI / 360 + 1e-12);
});

test("the landing has a tiny rebound and returns to exact stable poses", () => {
  const source = stack(8),
    plan = planFor(source),
    event = plan.tracks[0].events[0];
  const arriving = source.chips.at(-1);
  let rebound = 0;
  for (let now = event.contactAt; now < event.contactAt + 80; now += 1)
    rebound = Math.max(
      rebound,
      byId(sampleChipLanding(plan, now), arriving.id).position[1] -
        arriving.position[1],
    );
  assert(
    rebound >= 0.002 && rebound <= 0.005,
    "rebound is millimetres, not a stack jump",
  );
  const end = sampleChipLanding(plan, plan.settlingUntil);
  assert.equal(end.active, false);
  assert.equal(end.done, true);
  for (const pose of end.poses) {
    const base = source.chips.find((chip) => chip.id === pose.id);
    assert.deepEqual(pose.position, base.position);
    assert.deepEqual(pose.rotation, base.rotation);
    assert(Math.abs(Math.hypot(...pose.quaternion) - 1) < 1e-12);
  }
});

test("25 staggered arrivals never intersect, sink, or escape their bounded slot", () => {
  const source = stack(33),
    plan = planFor(source, 25);
  const from = source.chips.length - plan.tracks[0].rows.length;
  for (
    let now = plan.startAt - 1;
    now <= plan.settlingUntil + 1;
    now += 1000 / 240
  ) {
    let support = from
      ? chipPoseBounds(source.chips[from - 1]).max[1]
      : source.floorY;
    for (const pose of sampleChipLanding(plan, now).poses) {
      if (!pose.visible) continue;
      const base = source.chips.find((chip) => chip.id === pose.id);
      const bounds = chipPoseBounds({ ...base, ...pose });
      assert(
        bounds.min[1] >= support - 1e-10,
        `intersection at ${now}, ${pose.id}`,
      );
      support = bounds.max[1];
      assert(pose.position[1] >= base.position[1] - 1e-10);
      assert(pose.position[1] <= base.position[1] + limits.drop + 0.01);
      assert(
        Math.hypot(
          pose.position[0] - base.position[0],
          pose.position[2] - base.position[2],
        ) <=
          limits.maxSlide + 1e-10,
      );
      assert(pose.position.every(Number.isFinite));
      assert(pose.quaternion.every(Number.isFinite));
    }
  }
});

test("new network arrivals extend an unfinished plan without restarting existing falls", () => {
  const oldStack = stack(9),
    first = planFor(oldStack);
  const newStack = stack(10),
    now = 1125;
  const extended = createChipLandingPlan({
    stacks: [newStack],
    added: [newStack.chips.at(-1)],
    startAt: now,
    previousPlan: first,
  });
  assert.equal(
    extended.tracks[0].events[0].startAt,
    first.tracks[0].events[0].startAt,
  );
  assert(extended.tracks[0].events[1].startAt >= now);
  const before = sampleChipLanding(first, now),
    after = sampleChipLanding(extended, now);
  for (const pose of before.poses) assert.deepEqual(byId(after, pose.id), pose);
  assert(extended.settlingUntil > first.settlingUntil);
});

test("plans are seekable, cloneable, and independent of renderer frame rate", () => {
  const plan = planFor(stack(15), 7),
    times = [999, 1000, 1090, 1250, 1510, plan.settlingUntil + 1];
  const expected = times.map((time) => sampleChipLanding(plan, time));
  for (let now = 1000; now < plan.settlingUntil; now += 1000 / 144)
    sampleChipLanding(plan, now);
  assert.deepEqual(
    times.map((time) => sampleChipLanding(plan, time)),
    expected,
  );
  for (let now = plan.settlingUntil; now > 999; now -= 1000 / 15)
    sampleChipLanding(plan, now);
  assert.deepEqual(
    times.map((time) => sampleChipLanding(structuredClone(plan), time)),
    expected,
  );
});

test("the render writer reuses pose arrays and response kernels across cohorts", () => {
  const source = stack(10),
    plan = planFor(source),
    another = planFor(stack(10, "other-bank"));
  assert.equal(
    plan.tracks[0].events[0].kernel,
    another.tracks[0].events[0].kernel,
  );
  const references = new Map();
  writeChipLandingPoses(plan, 1200, (id, pose) =>
    references.set(id, {
      pose,
      position: pose.position,
      quaternion: pose.quaternion,
    }),
  );
  writeChipLandingPoses(plan, 1230, (id, pose) => {
    assert.equal(pose, references.get(id).pose);
    assert.equal(pose.position, references.get(id).position);
    assert.equal(pose.quaternion, references.get(id).quaternion);
  });
  const prepared = prewarmChipLandingResponses([
    { diameter: 0.23, thicknessScale: 1.15 },
    { diameter: 0.23, thicknessScale: 1.15 },
  ]);
  assert.equal(
    prepared,
    4,
    "warm each physical dimension once, not once per denomination or player",
  );
});

test("12-player cohorts use at most four cached physics bodies and preserve all source IDs/denominations", () => {
  const stacks = Array.from({ length: 12 }, (_, index) =>
    stack(18, `p${index}`, 0.615, 0.23),
  );
  const inputs = structuredClone(stacks);
  const plan = createChipLandingPlan({
    stacks,
    addedIds: stacks.flatMap((pile) =>
      pile.chips.slice(-10).map((chip) => chip.id),
    ),
    startAt: 5000,
  });
  assert.equal(plan.tracks.length, 12);
  assert(
    plan.tracks.every((track) =>
      track.events.every((event) => event.kernel.bodyCount <= 4),
    ),
  );
  assert.equal(
    new Set(
      plan.tracks.flatMap((track) => track.events.map((event) => event.kernel)),
    ).size,
    1,
    "all 120 arrivals reuse one dimension/contact response",
  );
  sampleChipLanding(plan, 5320);
  assert.deepEqual(stacks, inputs);
  assert.equal(
    sampleChipLanding(plan, plan.settlingUntil).poses.length,
    12 * 13,
  );
});

test("withdrawals create no drop and invalid inserted/intersecting stacks are rejected", () => {
  const source = stack(5);
  assert.deepEqual(
    sampleChipLanding(
      createChipLandingPlan({ stacks: [source], addedIds: [], startAt: 1000 }),
      1000,
    ).poses,
    [],
  );
  assert.throws(
    () =>
      createChipLandingPlan({
        stacks: [source],
        addedIds: [source.chips[1].id],
        startAt: 0,
      }),
    /append/,
  );
  const intersecting = structuredClone(source);
  intersecting.chips.at(-1).position[1] -= 0.01;
  assert.throws(() => planFor(intersecting), /intersect/);
  assert.throws(() => createChipLandingPlan({ stacks: [source] }), /startAt/);
  assert.throws(() => sampleChipLanding(planFor(source), NaN), /finite/);
});
