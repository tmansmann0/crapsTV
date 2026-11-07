import test from "node:test";
import assert from "node:assert/strict";
import { PerspectiveCamera, Vector3, Quaternion } from "three";
import { createTVLayout } from "../src/tv-layout.js";
import { readFileSync } from "node:fs";
import { createThrowTimeline, sampleThrow } from "../src/throw-motion.js";
import {
  THROW_CAMERA_RIGS,
  RESULT_CAMERA_HOLD_MS,
  sampleThrowCamera,
  sampleTableCamera,
  BETWEEN_ROUND_BREATHER_MS,
  BETTING_TABLE_BOUNDS,
  fitBettingCamera,
  throwCameraRig,
} from "../src/throw-camera.js";

test("optional wide framing can fit full table/banks when explicitly requested", () => {
  const seats = JSON.parse(
    readFileSync(
      new URL(
        "../public/assets/table-player-rails-layout.json",
        import.meta.url,
      ),
    ),
  ).seats;
  for (const [width, height] of [
    [1920, 1080],
    [3840, 2160],
    [1280, 800],
  ])
    for (const uiSize of ["compact", "large"]) {
      const layout = createTVLayout(width, height, { uiSize });
      const hudRects = ["brand", "join", "status", "settingsButton"].map(
        (id) => layout.panels[id],
      );
      const top = Math.max(
        ...hudRects
          .filter((r) => r.y + r.height <= height * 0.5)
          .map((r) => r.y + r.height),
      );
      const bottom = Math.min(
        ...hudRects.filter((r) => r.y >= height * 0.5).map((r) => r.y),
      );
      const shot = fitBettingCamera({
        aspect: width / height,
        top: top / height,
        bottom: bottom / height,
        horizontalLimit: 1 - (160 * (height / 1080)) / width,
      });
      const camera = new PerspectiveCamera(shot.fov, width / height, 0.1, 160);
      camera.position.fromArray(shot.position);
      camera.lookAt(new Vector3(...shot.target));
      camera.updateMatrixWorld(true);
      const points = [];
      for (const x of [
        BETTING_TABLE_BOUNDS.min[0],
        BETTING_TABLE_BOUNDS.max[0],
      ])
        for (const y of [0, 1.9])
          for (const z of [
            BETTING_TABLE_BOUNDS.min[2],
            BETTING_TABLE_BOUNDS.max[2],
          ])
            points.push([x, y, z]);
      for (const seat of seats)
        for (const slot of seat.stackSlots)
          for (const dx of [-0.12, 0.12])
            for (const dz of [-0.12, 0.12])
              for (const y of [0.675, 1.8])
                points.push([slot.position[0] + dx, y, slot.position[2] + dz]);
      for (const point of points) {
        const p = new Vector3(...point).project(camera),
          py = ((1 - p.y) * height) / 2;
        assert.ok(
          Math.abs(p.x) < 1 && p.z > -1 && p.z < 1,
          "table/bank point is in the camera frustum",
        );
        assert.ok(
          py > top && py < bottom,
          `${width}x${height} ${uiSize} bank point ${point} is beneath HUD`,
        );
      }
    }
});

test("Auto rests wide in the lobby and nearly overhead during active betting", () => {
  const lobby = sampleTableCamera({ state: { status: "lobby" }, now: 0 });
  assert.equal(lobby.phase, "lobby");
  const playing = sampleTableCamera({ state: { status: "playing" }, now: 0 });
  assert.equal(playing.phase, "betting");
  const horizontal = Math.hypot(
    playing.position[0] - playing.target[0],
    playing.position[2] - playing.target[2],
  );
  assert.ok(horizontal / (playing.position[1] - playing.target[1]) < 0.16);
});

test("a long betting window permits only a one-second breather after result hold", () => {
  const state = {
    status: "playing",
    rolling: false,
    throw: throwState,
    nextRollAt: 13500,
  };
  const resultEnd = throwState.settledAt + RESULT_CAMERA_HOLD_MS;
  assert.equal(
    sampleTableCamera({ state, now: resultEnd - 1 }).phase,
    "betting",
  );
  assert.equal(sampleTableCamera({ state, now: resultEnd }).phase, "breather");
  assert.equal(
    sampleTableCamera({ state, now: resultEnd + BETWEEN_ROUND_BREATHER_MS })
      .phase,
    "betting",
  );
  assert.equal(
    sampleTableCamera({ state, now: resultEnd, reducedMotion: true }).phase,
    "betting",
  );
  for (const nextRollAt of [resultEnd, resultEnd + 3999])
    assert.equal(
      sampleTableCamera({ state: { ...state, nextRollAt }, now: resultEnd })
        .phase,
      "betting",
    );
  assert.equal(sampleTableCamera({ state, now: 12000 }).phase, "betting");
});

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
  assert.equal(first.fov, 54);
  assert.ok(first.fov > middle.fov && middle.fov > last.fov);
  assert.ok(last.fov >= 48);
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

test("inside table-level rigs keep both dice framed across actual recorded trajectories", () => {
  let tested = 0;
  for (let seed = 1; seed <= 16; seed++) {
    let timeline;
    try {
      timeline = createThrowTimeline({
        id: `low-camera-${seed}`,
        seed,
        startAt: 1000,
        duration: 2500,
        gesture: { x: ((seed % 3) - 1) * 0.7, power: 0.35 + (seed % 4) * 0.2 },
      });
    } catch (error) {
      if (error.code === "DICE_UNSETTLED") continue;
      throw error;
    }
    tested++;
    const selected = throwCameraRig(timeline);
    assert.equal(throwCameraRig(structuredClone(timeline)), selected);
    for (let t = 0; t < 2200; t += 110) {
      const pose = sampleThrow(timeline, 1000 + t);
      const shot = sampleThrowCamera({
        throwState: timeline,
        pose,
        now: 1000 + t,
        aspect: 16 / 9,
      });
      assert.equal(shot.rig, selected);
      assert.ok(shot.position[1] >= 0.38 && shot.position[1] <= 0.391);
      assert.equal(Math.abs(shot.position[0]), 5);
      assert.equal(Math.abs(shot.position[2]), 2.3);
      const camera = new PerspectiveCamera(shot.fov, 16 / 9, 0.035, 160);
      camera.position.fromArray(shot.position);
      camera.lookAt(new Vector3(...shot.target));
      camera.updateMatrixWorld();
      for (const die of pose.dice)
        for (const x of [-0.11, 0.11])
          for (const y of [-0.11, 0.11])
            for (const z of [-0.11, 0.11]) {
              const p = new Vector3(x, y, z)
                .applyQuaternion(new Quaternion(...die.quaternion))
                .add(new Vector3(...die.position))
                .project(camera);
              assert.ok(
                Math.abs(p.x) < 1 && Math.abs(p.y) < 1 && p.z > -1 && p.z < 1,
                `seed ${seed} t=${t}: clipped`,
              );
            }
    }
  }
  assert.ok(tested >= 10);
});

test("default playing view is close and top-down, independently of outer bank framing", () => {
  const view = sampleTableCamera({
    state: { status: "playing" },
    now: 0,
    aspect: 16 / 9,
  });
  assert.ok(view.position[1] >= 8 && view.position[1] <= 10);
  assert.ok(Math.abs(view.position[2] - view.target[2]) < 1.6);
});

test("overhead results keep dice clear of brand, invite, and result panels", () => {
  for (const [width, height] of [
    [1920, 1080],
    [3840, 2160],
    [1280, 800],
    [650, 650],
    [390, 844],
  ]) {
    const layout = createTVLayout(width, height);
    const hudRects = ["brand", "join", "status", "settingsButton"].map(
      (id) => layout.panels[id],
    );
    const panels = hudRects.map(({ x, y, width, height }) => [
      x,
      y,
      width,
      height,
    ]);
    for (const x of [-4.9, -2.5, 0, 2.5, 4.9])
      for (const z of [-2.3, -1, 0, 1, 2.3]) {
        const positions = pose([x, 0.11, z], [-x, 0.11, -z]);
        const shot = sample(3200, positions, {
          aspect: width / height,
          viewportWidth: width,
          viewportHeight: height,
          hudRects,
        });
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
