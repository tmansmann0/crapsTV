import test from "node:test";
import assert from "node:assert/strict";
import { PerspectiveCamera, Vector3 } from "three";
import {
  THROW_CAMERA_RIGS,
  RESULT_CAMERA_HOLD_MS,
  sampleThrowCamera,
  throwCameraRig,
} from "../src/throw-camera.js";

const throwState = {
  id: "camera-test",
  seed: 47291,
  startAt: 1000,
  settledAt: 3200,
  duration: 2500,
};
const pose = (a, b) => ({ dice: [{ position: a }, { position: b }] });
const sample = (
  now,
  positions = pose([-0.2, 0.15, -1.5], [0.2, 0.15, -1.5]),
  extra = {},
) =>
  sampleThrowCamera({
    throwState,
    pose: positions,
    now,
    aspect: 16 / 9,
    ...extra,
  });

test("a throw keeps its selected corner as the dice travel across the table", () => {
  const first = sample(1000, pose([-1, 0.2, 1.8], [1, 0.4, 1.9]));
  const last = sample(3199, pose([-4, 0.15, -2.1], [3, 0.15, -1.8]));
  assert.equal(first.phase, "throw");
  assert.equal(last.rig, first.rig);
  assert.deepEqual(
    [first.position[0], first.position[2]],
    [last.position[0], last.position[2]],
  );
  assert.ok(Math.abs(last.position[1] - first.position[1]) <= 0.05);
  assert.notDeepEqual(last.target, first.target);
  assert.equal(first.rig, throwCameraRig({ ...throwState }));
  assert.deepEqual(first.position, THROW_CAMERA_RIGS[first.rig]);
});

test("camera zoom progresses slowly without moving its rig toward the dice", () => {
  const first = sample(1000),
    middle = sample(2100),
    last = sample(3199);
  assert.equal(first.fov, 46);
  assert.ok(first.fov > middle.fov && middle.fov > last.fov);
  assert.ok(last.fov >= 40);
  assert.ok(
    Math.hypot(...last.position.map((v, i) => v - first.position[i])) < 0.051,
  );
});

test("settle time cuts directly overhead, holds briefly, then releases the camera", () => {
  assert.equal(sample(3199).phase, "throw");
  const overhead = sample(3200);
  assert.equal(overhead.phase, "result");
  assert.equal(overhead.position[0], overhead.target[0]);
  assert.ok(Math.abs(overhead.position[2] - overhead.target[2]) < 0.005);
  assert.ok(overhead.position[1] - overhead.target[1] >= 3);
  assert.equal(sample(3200 + RESULT_CAMERA_HOLD_MS - 1).phase, "result");
  assert.equal(sample(3200 + RESULT_CAMERA_HOLD_MS), null);
  assert.equal(sample(999), null);
});

test("late joining uses the current shot, and reduced motion skips choreography", () => {
  assert.deepEqual(sample(4000), sample(4000));
  assert.equal(sample(2000, undefined, { reducedMotion: true }), null);
  assert.equal(sample(4000, undefined, { reducedMotion: true }), null);
  assert.equal(sampleThrowCamera({ throwState, pose: null, now: 2000 }), null);
  assert.equal(
    sampleThrowCamera({ throwState: null, pose: null, now: 2000 }),
    null,
  );
});

test("all corner and overhead shots fit both complete dice in landscape and portrait", () => {
  const spread = pose([-4.9, 0.15, 2.2], [4.9, 0.15, -2.2]);
  const visited = new Set();
  for (let seed = 0; seed < 24; seed++)
    for (const aspect of [16 / 9, 1, 9 / 16])
      for (const now of [1500, 3200]) {
        const shot = sample(now, spread, {
          throwState: { ...throwState, seed },
          aspect,
        });
        visited.add(shot.rig);
        const camera = new PerspectiveCamera(shot.fov, aspect, 0.1, 160);
        camera.position.fromArray(shot.position);
        camera.lookAt(new Vector3(...shot.target));
        camera.updateMatrixWorld();
        for (const { position } of spread.dice)
          for (const dx of [-0.15, 0.15])
            for (const dy of [-0.15, 0.15])
              for (const dz of [-0.15, 0.15]) {
                const projected = new Vector3(
                  position[0] + dx,
                  position[1] + dy,
                  position[2] + dz,
                ).project(camera);
                assert.ok(
                  Math.abs(projected.x) < 1 && Math.abs(projected.y) < 1,
                  `rig ${shot.rig}, ${shot.phase}, aspect ${aspect}: dice clipped`,
                );
                assert.ok(projected.z > -1 && projected.z < 1);
              }
      }
  assert.equal(visited.size, 4);
});

test("overhead results keep dice clear of brand, invite, and result panels", () => {
  for (const [width, height] of [
    [1280, 800],
    [650, 650],
    [390, 844],
  ]) {
    const small = width < 650,
      joinScale = small ? 0.8 : 1;
    const statusScale = Math.min(1, (width - 28) / 410);
    const panels = [
      [
        small ? 64 : 82,
        small ? 0 : 4,
        205 * (small ? 0.76 : 1),
        86 * (small ? 0.76 : 1),
      ],
      [
        width - 286 * joinScale - (small ? 12 : 24),
        small ? 78 : 24,
        286 * joinScale,
        126 * joinScale,
      ],
      [
        (width - 410 * statusScale) / 2,
        height - 62 * statusScale - 20,
        410 * statusScale,
        62 * statusScale,
      ],
    ];
    for (const x of [-4.9, -2.5, 0, 2.5, 4.9])
      for (const z of [-2.3, -1, 0, 1, 2.3]) {
        const positions = pose([x, 0.11, z], [-x, 0.11, -z]);
        const shot = sample(3200, positions, { aspect: width / height });
        const camera = new PerspectiveCamera(
          shot.fov,
          width / height,
          0.1,
          160,
        );
        camera.position.fromArray(shot.position);
        camera.lookAt(new Vector3(...shot.target));
        camera.updateMatrixWorld();
        for (const die of positions.dice) {
          const corners = [];
          for (const dx of [-0.15, 0.15])
            for (const dy of [-0.15, 0.15])
              for (const dz of [-0.15, 0.15]) {
                const p = new Vector3(
                  die.position[0] + dx,
                  die.position[1] + dy,
                  die.position[2] + dz,
                ).project(camera);
                corners.push([
                  ((p.x + 1) * width) / 2,
                  ((1 - p.y) * height) / 2,
                ]);
              }
          const left = Math.min(...corners.map((p) => p[0])),
            right = Math.max(...corners.map((p) => p[0]));
          const top = Math.min(...corners.map((p) => p[1])),
            bottom = Math.max(...corners.map((p) => p[1]));
          for (const [px, py, pw, ph] of panels)
            assert.ok(
              right < px || left > px + pw || bottom < py || top > py + ph,
              `dice at ${x},${z} overlap HUD at ${width}x${height}`,
            );
        }
      }
  }
});
