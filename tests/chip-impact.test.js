import test from "node:test";
import assert from "node:assert/strict";
import {
  createChipImpacts,
  findChipImpactCandidates,
  sampleChipImpact,
  CHIP_IMPACT_LIMITS as limits,
} from "../src/chip-impact.js";
const frame = (t, x, y = 0.12, z = 0) => [
  t,
  x,
  y,
  z,
  0,
  0,
  0,
  1,
  5,
  2,
  5,
  0,
  0,
  0,
  1,
];
const flight = (y = 0.12, z = 0) => ({
  id: "throw",
  startAt: 1000,
  duration: 2500,
  frames: [frame(0, -1, y, z), frame(300, 1, y, z), frame(2500, 1, y, z)],
});
const stack = (count = 4, x = 0, floor = 0.014) => ({
  id: `stack:${x}`,
  floorY: floor,
  chips: Array.from({ length: count }, (_, i) => ({
    id: `${x}:${i}`,
    position: [x, floor + 0.026195 + i * 0.05439, 0],
    rotation: [0, i * 0.1, 0],
    diameter: 0.31,
    thicknessScale: 1.3,
  })),
});

test("only a fast direct height-overlapping approach qualifies", () => {
  assert.equal(findChipImpactCandidates(flight(), [stack()]).length, 1);
  assert.equal(
    findChipImpactCandidates(flight(0.9), [stack()]).length,
    0,
    "above stack",
  );
  assert.equal(
    findChipImpactCandidates(flight(0.12, 0.14), [stack()]).length,
    0,
    "glancing pass",
  );
  assert.equal(
    findChipImpactCandidates(flight(0.12, 0.8), [stack()]).length,
    0,
    "miss",
  );
  const slow = flight();
  slow.frames = [frame(0, -0.5), frame(1500, 0.5), frame(2500, 0.5)];
  assert.equal(
    findChipImpactCandidates(slow, [stack()]).length,
    0,
    "slow roll",
  );
  assert.equal(
    findChipImpactCandidates(flight(), [stack(6, 0, 0.675)]).length,
    0,
    "raised bank is protected",
  );
});
test("late motion is ignored so recovery cannot interrupt settlement", () => {
  const late = flight();
  late.frames = [frame(0, -1), frame(1500, -1), frame(1800, 1), frame(2500, 1)];
  assert.equal(findChipImpactCandidates(late, [stack()]).length, 0);
});
test("Cannon contact actually moves and tips top chips while lower chips stay put", () => {
  const chips = stack(6);
  const tracks = createChipImpacts(flight(0.23), [chips]);
  assert.equal(tracks.length, 1);
  const track = tracks[0];
  assert(track.startAt + track.physicsMs + track.recoveryMs <= 1000 + 2500);
  assert.deepEqual(
    track.chipIds,
    chips.chips.slice(-3).map((c) => c.id),
  );
  const maximumMove = Math.max(
    ...track.frames.flatMap((f) =>
      f.poses.map((p, i) =>
        Math.hypot(
          p.position[0] - track.original[i].position[0],
          p.position[2] - track.original[i].position[2],
        ),
      ),
    ),
  );
  const maximumTilt = Math.max(
    ...track.frames.flatMap((f) =>
      f.poses.map((p) => Math.hypot(p.quaternion[0], p.quaternion[2])),
    ),
  );
  assert(maximumMove > 0.01, "a real impulse displaced chips");
  assert(maximumTilt > 0.01, "contact torque tilted chips");
  assert(maximumMove <= limits.maxDisplacement + 1e-8);
  for (const f of track.frames)
    for (const [i, p] of f.poses.entries()) {
      assert(p.position[1] >= chips.floorY);
      assert(
        p.position[1] <= track.original[i].position[1] + limits.maxLift + 1e-8,
      );
      assert(p.position.every(Number.isFinite));
      assert(Math.abs(Math.hypot(...p.quaternion) - 1) < 1e-5);
    }
});
test("at most two stacks and three top chips per stack can react", () => {
  const list = [stack(6, -0.6), stack(6, 0), stack(6, 0.6)];
  const candidates = findChipImpactCandidates(flight(0.23), list);
  assert.equal(candidates.length, 2);
  assert(candidates.every((c) => c.selected.length === 3));
  assert.deepEqual(
    candidates.map((c) => c.stack.id),
    ["stack:-0.6", "stack:0"],
  );
});
test("trajectory and stack input are immutable; independent clients get identical contacts", () => {
  const timeline = flight(),
    chips = [stack()];
  const original = structuredClone({ timeline, chips });
  assert.deepEqual(
    createChipImpacts(timeline, chips),
    createChipImpacts(timeline, chips),
  );
  assert.deepEqual({ timeline, chips }, original);
});
test("stateless seeking is identical at low/high frame rates and reconnect times", () => {
  const [track] = createChipImpacts(flight(), [stack()]);
  assert(track);
  const now = track.startAt + 240;
  const expected = sampleChipImpact(track, now);
  for (let t = track.startAt; t < now; t += 1000 / 144)
    sampleChipImpact(track, t);
  assert.deepEqual(sampleChipImpact(track, now), expected);
  for (let t = track.startAt; t < now; t += 1000 / 15)
    sampleChipImpact(track, t);
  assert.deepEqual(sampleChipImpact(track, now), expected);
  assert.deepEqual(sampleChipImpact(structuredClone(track), now), expected);
  assert.equal(sampleChipImpact(track, track.startAt - 1).active, false);
  const end = sampleChipImpact(
    track,
    track.startAt + track.physicsMs + track.recoveryMs + 1,
  );
  assert.equal(end.done, true);
  assert.deepEqual(end.poses, track.original);
});
