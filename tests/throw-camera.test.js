import test from "node:test";
import assert from "node:assert/strict";
import { PerspectiveCamera, Vector3, Quaternion } from "three";
import { createTVLayout } from "../src/tv-layout.js";
import { readFileSync } from "node:fs";
import {
  planOutcomeTour,
  sampleOutcomeTour,
} from "../src/round-presentation.js";
import { SEAT_LAYOUT, arcPosition } from "../src/chip-flow.js";
import { wagerStackLayout, wagerPosition } from "../src/wager-layout.js";
import { createThrowTimeline, sampleThrow } from "../src/throw-motion.js";
import {
  THROW_CAMERA_RIGS,
  RESULT_CAMERA_HOLD_MS,
  sampleThrowCamera,
  sampleTableCamera,
  IDLE_PLAYER_SHOT_MS,
  IDLE_OVERVIEW_MS,
  sampleOutcomeCamera,
  samplePlayerAreaCamera,
  planFiniteIdleCamera,
  IDLE_MAX_SHOTS,
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

test("idle camera makes one finite pass over active players and then holds overhead", () => {
  const state = {
    code: "finite-basic",
    status: "playing",
    bettingOpenedAt: 1000,
    nextRollAt: 1000,
    players: [
      { id: "a", name: "A", seat: 0, bets: [{ id: "a1", amount: 500 }] },
      { id: "b", name: "B", seat: 7, bets: [{ id: "b1", amount: 500 }] },
    ],
  };
  const first = sampleTableCamera({ state, now: 2300 });
  assert.equal(first.phase, "idle-player");
  assert.ok(first.idleShotCount <= IDLE_MAX_SHOTS);
  for (const now of [first.idleTourEndAt + 1, 50000, 120000]) {
    const held = sampleTableCamera({ state, now });
    assert.equal(held.phase, "betting");
    assert.equal(held.idleTourEndAt, first.idleTourEndAt);
  }
  assert.equal(
    sampleTableCamera({ state, now: 2400, reducedMotion: true }).phase,
    "betting",
  );
  assert.equal(
    sampleTableCamera({ state: { ...state, rolling: true }, now: 2400 }).phase,
    "betting",
  );
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
  assert.ok(view.position[1] >= 6.8 && view.position[1] < 8.8);
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

function tourState(count = 4, deadline = 13000) {
  const seats = [0, 6, 9, 5, 1, 7, 10, 2, 8, 11, 3, 4];
  const players = Array.from({ length: count }, (_, i) => ({
    id: `player${i}`,
    name: `Player ${i}`,
    seat: seats[i],
    bets: [],
  }));
  const events = players.map((player, i) => ({
    playerId: player.id,
    name: player.name,
    delta: i % 3 === 0 ? 500 : i % 3 === 1 ? -500 : 0,
    bets: [
      {
        betId: `bet${i}`,
        label: i % 3 === 0 ? "Field" : i % 3 === 1 ? "Place 10" : "Don't pass",
        result: i % 3 === 0 ? "win" : i % 3 === 1 ? "lose" : "push",
        amount: 500,
        delta: i % 3 === 0 ? 500 : i % 3 === 1 ? -500 : 0,
        sourceBet: {
          id: `bet${i}`,
          type: i % 3 === 0 ? "field" : i % 3 === 1 ? "place-10" : "dont",
          amount: 500,
        },
      },
    ],
  }));
  const state = {
    status: "playing",
    config: { mode: "craps" },
    players,
    bettingOpenedAt: 1000,
    nextRollAt: deadline,
    lastRoll: { id: `round${count}`, at: 1000, events },
    throw: { id: "prior", startAt: 0, duration: 1000, settledAt: 700 },
  };
  state.lastRoll.presentation = planOutcomeTour(state, {
    startAt: 2400,
    deadline,
  });
  return state;
}

test("outcome shots follow the exact shared slots, include pushes, and return correct summary metadata", () => {
  const state = tourState();
  const plan = state.lastRoll.presentation;
  for (const slot of plan.slots) {
    const now = slot.startAt + 300;
    const shot = sampleTableCamera({ state, now });
    assert.equal(
      shot.phase,
      slot.kind === "group" ? "outcome-group" : "outcome-player",
    );
    assert.equal(shot.playerId, slot.playerId);
    assert.equal(shot.name, slot.name);
    assert.equal(shot.delta, slot.delta);
    assert.deepEqual(
      shot.bets.map((bet) => bet.result).sort(),
      state.lastRoll.events
        .filter((event) => slot.playerIds.includes(event.playerId))
        .flatMap((event) => event.bets.map((bet) => bet.result))
        .sort(),
    );
    assert.equal(
      shot.shotKey,
      `outcome:${plan.rollId}:${plan.slots.indexOf(slot)}`,
    );
    assert.equal(
      sampleTableCamera({ state, now, reducedMotion: true }).phase,
      "betting",
    );
    assert.equal(
      sampleTableCamera({ state: { ...state, rolling: true }, now }).phase,
      "betting",
    );
  }
  assert.deepEqual(
    plan.slots.flatMap((slot) => slot.playerIds).sort(),
    state.players.map((player) => player.id).sort(),
  );
});

test("payout views frame the current moving chips throughout each shared slot", () => {
  const state = tourState();
  const plan = state.lastRoll.presentation;
  for (const [width, height] of [
    [1920, 1080],
    [3840, 2160],
  ]) {
    const layout = createTVLayout(width, height),
      hudRects = ["brand", "join", "status", "settingsButton"].map(
        (id) => layout.panels[id],
      );
    for (const slot of plan.slots)
      for (const progress of [0.02, 0.25, 0.5, 0.9]) {
        const now = slot.startAt + (slot.endAt - slot.startAt) * progress;
        const shot = sampleOutcomeCamera({
          state,
          plan,
          sample: sampleOutcomeTour(plan, now),
          now,
          aspect: width / height,
          viewportHeight: height,
          hudRects,
        });
        const camera = new PerspectiveCamera(
          shot.fov,
          width / height,
          0.035,
          160,
        );
        camera.position.fromArray(shot.position);
        camera.lookAt(new Vector3(...shot.target));
        camera.updateMatrixWorld(true);
        const focus =
          shot.focusPoints ||
          plan.transfers
            .filter((flow) => slot.playerIds.includes(flow.playerId))
            .flatMap((flow) => {
              const routePoint = (route) => {
                if (route.kind === "dealer") return [0, 1.2, -3.03];
                if (route.kind === "bank") {
                  const bank =
                    SEAT_LAYOUT[
                      state.players.find((p) => p.id === route.playerId).seat
                    ].center;
                  return [bank[0], bank[1] + 0.13, bank[2]];
                }
                const point = wagerPosition(route, state);
                point[1] += 0.12;
                return point;
              };
              const from = routePoint(flow.from),
                to = routePoint(flow.to);
              return [0, 0.25, 0.5, 0.75, 1].map((p) =>
                arcPosition(from, to, p),
              );
            });
        assert.ok(focus.length >= 5);
        for (const point of focus)
          for (const x of [-0.15, 0.15])
            for (const y of [-0.15, 0.3])
              for (const z of [-0.15, 0.15]) {
                const p = new Vector3(
                  point[0] + x,
                  point[1] + y,
                  point[2] + z,
                ).project(camera);
                const px = ((p.x + 1) * width) / 2,
                  py = ((1 - p.y) * height) / 2;
                assert.ok(
                  Math.abs(p.x) < 1 && Math.abs(p.y) < 1 && p.z > -1 && p.z < 1,
                  `transfer clipped for ${slot.name}`,
                );
                assert.ok(
                  hudRects.every(
                    (r) =>
                      px < r.x ||
                      px > r.x + r.width ||
                      py < r.y ||
                      py > r.y + r.height,
                  ),
                );
              }
      }
  }
});

test("overflow outcomes use a group overview and never extend the configured roll deadline", () => {
  const state = tourState(12, 10000),
    plan = state.lastRoll.presentation;
  assert.ok(plan.endAt <= state.nextRollAt);
  const group = plan.slots.find((slot) => slot.kind === "group");
  assert.ok(group);
  const shot = sampleTableCamera({ state, now: group.startAt + 100 });
  assert.equal(shot.phase, "outcome-group");
  assert.equal(shot.playerCount, group.playerIds.length);
});

test("player-area scans use distinct seated human angles with soft deterministic movement", () => {
  const positions = [];
  for (let seat = 0; seat < 12; seat++) {
    const player = { id: `p${seat}`, name: `P${seat}`, seat },
      slot = { seat, startAt: 1000, endAt: 4000 };
    const first = samplePlayerAreaCamera({
        player,
        slot,
        now: 1000,
        phase: "idle-player",
      }),
      last = samplePlayerAreaCamera({
        player,
        slot,
        now: 3999,
        phase: "idle-player",
      });
    assert.ok(first.position[1] > first.target[1] + 0.3);
    assert.ok(first.target[1] >= SEAT_LAYOUT[seat].center[1]);
    assert.ok(
      Math.hypot(
        ...first.target.map((v, i) => v - SEAT_LAYOUT[seat].center[i]),
      ) < 0.9,
    );
    assert.ok(
      Math.hypot(...first.position.map((v, i) => v - last.position[i])) < 1.5,
    );
    assert.ok(last.fov <= first.fov);
    positions.push(first.position.join(","));
  }
  assert.equal(new Set(positions).size, 12);
});

test("shortened cooldowns and new throws preempt outcome tours, including old-host fallback", () => {
  const state = tourState();
  const now = state.lastRoll.presentation.startAt + 250;
  assert.match(sampleTableCamera({ state, now }).phase, /^outcome-/);
  assert.doesNotMatch(
    sampleTableCamera({ state: { ...state, nextRollAt: now - 1 }, now }).phase,
    /^outcome-/,
  );
  delete state.lastRoll.presentation;
  const fallback = planOutcomeTour(state);
  const shot = sampleTableCamera({ state, now: fallback.startAt + 250 });
  assert.equal(
    shot.phase,
    fallback.slots[0].kind === "group" ? "outcome-group" : "outcome-player",
  );
  assert.deepEqual(shot.playerIds, fallback.slots[0].playerIds);
});

test("closer betting overview retains all actual wager regions outside the HUD", () => {
  const width = 1920,
    height = 1080,
    layout = createTVLayout(width, height),
    hudRects = ["brand", "join", "status", "settingsButton"].map(
      (id) => layout.panels[id],
    );
  for (const mode of ["craps", "crapless"]) {
    const types = [
      "pass",
      "dont",
      "field",
      "come",
      "dontcome",
      "hard-4",
      "hard-6",
      "hard-8",
      "hard-10",
      "big-6",
      "big-8",
      "prop-2",
      "prop-3",
      "prop-7",
      "prop-11",
      "prop-12",
      "craps",
      ...[2, 3, 4, 5, 6, 8, 9, 10, 11, 12]
        .filter((n) => mode === "crapless" || ![2, 3, 11, 12].includes(n))
        .map((n) => `place-${n}`),
    ];
    const state = {
      status: "playing",
      config: { mode },
      players: Array.from({ length: 12 }, (_, seat) => ({
        id: `s${seat}`,
        seat,
        bets: types.map((type, i) => ({ id: `b${i}`, type, amount: 1900 })),
      })),
    };
    const shot = sampleTableCamera({
      state,
      now: 0,
      aspect: width / height,
      viewportWidth: width,
      viewportHeight: height,
      hudRects,
    });
    const camera = new PerspectiveCamera(shot.fov, width / height, 0.035, 160);
    camera.position.fromArray(shot.position);
    camera.lookAt(new Vector3(...shot.target));
    camera.updateMatrixWorld(true);
    for (const stack of wagerStackLayout(state))
      for (const dx of [-stack.radius, stack.radius])
        for (const dz of [-stack.radius, stack.radius]) {
          const p = new Vector3(
            stack.position[0] + dx,
            stack.position[1],
            stack.position[2] + dz,
          ).project(camera);
          const x = ((p.x + 1) * width) / 2,
            y = ((1 - p.y) * height) / 2;
          assert.ok(Math.abs(p.x) < 1 && Math.abs(p.y) < 1);
          assert.ok(
            hudRects.every(
              (rect) =>
                x < rect.x ||
                x > rect.x + rect.width ||
                y < rect.y ||
                y > rect.y + rect.height,
            ),
            `${mode} ${stack.betId} hidden by HUD`,
          );
        }
  }
});

test("a solo player already featured in settlement receives no redundant idle portrait", () => {
  const state = tourState(1);
  state.code = "solo-held";
  const end = state.lastRoll.presentation.endAt;
  for (const now of [end + 1, end + 1500, end + 60000]) {
    const shot = sampleTableCamera({ state, now });
    assert.equal(shot.phase, "betting");
    assert.equal(shot.idleShotCount, 0);
  }
});

test("idle passes ignore repeated financial/preview updates but welcome a new player once", () => {
  const state = {
    code: "idle-no-restart",
    status: "playing",
    createdAt: 10,
    bettingOpenedAt: 1000,
    players: [
      { id: "a", name: "A", seat: 0, bets: [{ id: "b", amount: 500 }] },
    ],
  };
  const first = sampleTableCamera({ state, now: 2300 });
  for (const snapshotAt of [20000, 21000, 22000]) {
    state.snapshotAt = snapshotAt;
    state.players[0].bets[0].amount += 500;
    state.players[0].betPreview = { amount: 1000, at: snapshotAt };
    const held = sampleTableCamera({ state, now: snapshotAt });
    assert.equal(held.phase, "betting");
    assert.equal(held.idleTourEndAt, first.idleTourEndAt);
  }
  state.players.push({
    id: "new",
    name: "New",
    seat: 6,
    joinedAt: 30000,
    bets: [],
  });
  const welcome = sampleTableCamera({ state, now: 31300 });
  assert.equal(welcome.phase, "idle-player");
  assert.equal(welcome.playerId, "new");
  assert.equal(sampleTableCamera({ state, now: 50000 }).phase, "betting");
});

test("idle planner considers only active unfeatured players and caps the one-pass selection", () => {
  const state = tourState(12);
  const active = state.players;
  const presentation = {
    slots: [{ kind: "player", playerIds: [active[0].id] }],
  };
  const first = planFiniteIdleCamera(state, { presentation, origin: 10000 });
  assert.ok(first.slots.length <= 3);
  assert.ok(first.slots.every((slot) => slot.playerId !== active[0].id));
  assert.equal(
    new Set(first.slots.map((slot) => slot.playerId)).size,
    first.slots.length,
  );
  assert.deepEqual(
    first,
    planFiniteIdleCamera(structuredClone(state), {
      presentation,
      origin: 10000,
    }),
  );
});

test("focused pairs and left clusters frame their own transfers rather than the full table", () => {
  const state = tourState(2);
  state.players[0].seat = 0;
  state.players[1].seat = 1;
  state.lastRoll.events.forEach((event, index) => {
    event.delta = 500;
    event.bets = [
      {
        betId: `field${index}`,
        label: "Field",
        result: "win",
        amount: 500,
        delta: 500,
        sourceBet: { id: `field${index}`, type: "field", amount: 500 },
      },
    ];
  });
  state.lastRoll.presentation = planOutcomeTour(state, { startAt: 2400 });
  const plan = state.lastRoll.presentation,
    base = plan.slots[0];
  const slot = {
    ...base,
    kind: "group",
    style: "pair",
    reason: "shared-win",
    playerId: null,
    playerIds: state.players.map((p) => p.id),
    focus: { region: "left" },
  };
  const sample = { slot, index: 0, progress: 0.5, transferProgress: 0.5 },
    now = slot.startAt + 750;
  const pair = sampleOutcomeCamera({ state, plan, sample, now });
  const wide = sampleOutcomeCamera({
    state,
    plan,
    sample: {
      ...sample,
      slot: { ...slot, style: "overview", reason: "overview" },
    },
    now,
  });
  assert.equal(pair.phase, "outcome-group");
  assert.equal(pair.style, "pair");
  assert.equal(pair.reason, "shared-win");
  assert.ok(pair.target[0] < -1);
  assert.ok(
    pair.position[0] > pair.target[0],
    "inboard side reveals the left stacks without looking through the cushion",
  );
  assert.ok(pair.position[1] < wide.position[1]);
  assert.ok(pair.focusPoints.length >= 10);
  const camera = new PerspectiveCamera(pair.fov, 16 / 9, 0.035, 160);
  camera.position.fromArray(pair.position);
  camera.lookAt(new Vector3(...pair.target));
  camera.updateMatrixWorld(true);
  for (const point of pair.focusPoints) {
    const p = new Vector3(...point).project(camera);
    assert.ok(Math.abs(p.x) < 1 && Math.abs(p.y) < 1 && p.z > -1 && p.z < 1);
  }
  const cluster = sampleOutcomeCamera({
    state,
    plan,
    sample: { ...sample, slot: { ...slot, style: "cluster", reason: "left" } },
    now,
  });
  assert.ok(cluster.target[0] < 0);
  assert.equal(cluster.region, "left");
});

test("payout camera is parked before transfer then tracks its actual current arc closely", () => {
  const state = tourState(1);
  const plan = state.lastRoll.presentation,
    slot = plan.slots[0];
  const at = (now) =>
    sampleOutcomeCamera({
      state,
      plan,
      sample: sampleOutcomeTour(plan, now),
      now,
    });
  const arrived = at(slot.arrivalAt),
    ready = at(slot.transferAt - 1);
  assert.deepEqual(arrived.position, ready.position);
  assert.deepEqual(arrived.target, ready.target);
  assert.equal(ready.preparing, true);
  assert.equal(ready.arrivalAt, slot.startAt);
  assert.equal(ready.transferAt, slot.transferAt);
  const mid = at(slot.transferAt + slot.flightMs / 2);
  const flown = arcPosition(
    [
      wagerPosition(plan.transfers[0].from, state)[0],
      0.134,
      wagerPosition(plan.transfers[0].from, state)[2],
    ],
    [
      SEAT_LAYOUT[state.players[0].seat].center[0],
      0.805,
      SEAT_LAYOUT[state.players[0].seat].center[2],
    ],
    0.5,
  );
  assert(Math.hypot(...mid.target.map((v, i) => v - flown[i])) < 0.25);
  assert(Math.hypot(...arrived.target.map((v, i) => v - mid.target[i])) > 0.5);
  assert.equal(arrived.shotKey, mid.shotKey);
  assert.equal(mid.preparing, false);
  assert(mid.position[1] > mid.target[1]);
});

test("finite detail visits vary low, overhead and bank angles and elevate for tall chips", () => {
  const player = {
    id: "detail",
    name: "Detail",
    seat: 2,
    bank: 100000,
    bets: [{ id: "tall", type: "pass", amount: 19400 }],
  };
  const state = { config: { mode: "craps" }, players: [player] };
  const slot = { seat: 2, startAt: 1000, endAt: 4000 };
  const shots = [];
  for (let i = 0; i < 100; i++)
    shots.push(
      samplePlayerAreaCamera({
        player,
        state,
        slot,
        now: 2500,
        roundId: `detail${i}`,
        phase: "idle-player",
      }),
    );
  assert.equal(new Set(shots.map((shot) => shot.shotVariant)).size, 6);
  const index = shots.findIndex((shot) => shot.shotVariant === "bet-low-glide");
  assert(index >= 0);
  const tall = shots[index];
  const smallPlayer = { ...player, bets: [{ ...player.bets[0], amount: 500 }] };
  const small = samplePlayerAreaCamera({
    player: smallPlayer,
    state: { ...state, players: [smallPlayer] },
    slot,
    now: 2500,
    roundId: `detail${index}`,
    phase: "idle-player",
  });
  const downAngle = (shot) =>
    Math.atan2(
      shot.position[1] - shot.target[1],
      Math.hypot(
        shot.position[0] - shot.target[0],
        shot.position[2] - shot.target[2],
      ),
    );
  assert(tall.subjectHeight > small.subjectHeight * 6);
  assert(tall.position[1] > small.position[1]);
  assert(downAngle(tall) > downAngle(small) + 0.3);
  assert(shots.find((shot) => shot.shotVariant === "bet-overhead").pitch > 1.4);
  assert(
    shots.find((shot) => shot.shotVariant === "bank-macro").subjectKind ===
      "bank",
  );
  const empty = { ...player, bets: [] };
  for (let i = 0; i < 15; i++)
    assert(
      samplePlayerAreaCamera({
        player: empty,
        state: { ...state, players: [empty] },
        slot,
        now: 2500,
        roundId: `empty${i}`,
      }).shotVariant.startsWith("bank-"),
    );
});
