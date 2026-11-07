import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as game from "../src/game.js";
import { createDicePhysics } from "../src/dice-physics.js";
import { sampleThrow, upperDieFace } from "../src/throw-motion.js";
import {
  createStartupShowcase,
  sampleStartup,
  STARTUP_DURATION_MS,
  STARTUP_FADE_MS,
  STARTUP_UI_AT,
} from "../src/startup-sequence.js";
import {
  startupCandidates,
  selectStartupProfile,
  probeStatistics,
  STARTUP_PROBE_AT,
} from "../src/startup-calibration.js";
import { resolveGraphics } from "../src/graphics-profile.js";

const showcase = createStartupShowcase();
const rollingStages = showcase.stages.filter(({ state }) => state.rolling);
const rounded = (n) => Math.round(n * 100000) / 100000;
const ledger = (state) =>
  state.players.map(({ id, bank, bets, stats }) => ({ id, bank, bets, stats }));

function freeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

test("opening retains both natural Cannon landings and never rewrites a resting face", () => {
  assert.equal(rollingStages.length, 2);
  for (const { state } of rollingStages) {
    const flight = state.throw;
    const physics = createDicePhysics(flight.props);
    physics.throwDice(flight.seed, flight.gesture);
    for (let frame = 0; frame < flight.frames.length - 1; frame++) {
      if (frame) {
        physics.step(1 / 120);
        physics.step(1 / 120);
      }
      assert.deepEqual(
        flight.frames[frame].slice(1),
        physics.bodies.flatMap((body) =>
          [...body.position.toArray(), ...body.quaternion.toArray()].map(
            rounded,
          ),
        ),
        `opening ${flight.id} frame ${frame} remains the recorded physical pose`,
      );
    }
    assert(physics.sleeping);
    const landed = sampleThrow(flight, flight.settledAt);
    assert.deepEqual(landed.dice, sampleThrow(flight, 60000).dice);
    landed.dice.forEach((die, index) => {
      const face = upperDieFace(die.quaternion);
      assert(face.alignment > 0.995);
      assert.equal(face.value, flight.dice[index]);
    });
  }
});

test("opening chip wins and losses use the real ledger and preserved wager sources", () => {
  for (const stage of rollingStages) {
    const after = showcase.stages.find(
      ({ at }) => at === stage.at + stage.state.throw.duration,
    ).state;
    const expected = structuredClone(stage.state);
    game.finishRoll(expected, expected.throw.dice);
    assert.deepEqual(ledger(after), ledger(expected));
    const events = after.lastRoll.events.flatMap((event) => event.bets);
    assert(events.some((bet) => bet.result === "win"));
    assert(events.some((bet) => bet.result === "lose"));
    const flows = after.lastRoll.presentation.transfers;
    assert(
      flows.some((flow) => flow.kind === "win" && flow.to.kind === "bank"),
    );
    assert(
      flows.some((flow) => flow.kind === "loss" && flow.to.kind === "dealer"),
    );
    for (const flow of flows) {
      const before = stage.state.players.find((p) => p.id === flow.playerId);
      const bet = before.bets.find((b) => b.id === flow.betId);
      assert(bet, "every chip transfer comes from an actual opening wager");
      assert.deepEqual(JSON.parse(JSON.stringify(flow.from.bet)), bet);
      assert(flow.amount > 0);
      assert(flow.startAt >= after.lastRoll.at);
      assert(flow.startAt + flow.duration <= after.nextRollAt);
    }
  }
});

test("isolated opening also works on HTTP LAN origins without crypto.randomUUID", () => {
  const moduleUrl = new URL("../src/startup-sequence.js", import.meta.url).href;
  const child = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `
    const random = globalThis.crypto.getRandomValues.bind(globalThis.crypto);
    Object.defineProperty(globalThis, 'crypto', {value: {getRandomValues: random}});
    const {createStartupShowcase} = await import(${JSON.stringify(moduleUrl)});
    const showcase = createStartupShowcase();
    if (showcase.stages.filter(stage => stage.state.rolling).length !== 2) process.exit(2);
  `,
    ],
    { encoding: "utf8" },
  );
  assert.equal(child.status, 0, child.stderr);
});

test("seeking the isolated opening never changes snapshots or a live room ledger", () => {
  const live = game.createState("LIVE");
  const player = game.join(live, "Actual player");
  game.start(live, player.id);
  game.place(live, player.id, "pass", 500);
  const before = structuredClone(live);
  const frozen = freeze(structuredClone(showcase));
  const copy = structuredClone(frozen);
  for (const time of [30000, 500, 27000, 6500, 10800, 19000, 24000, 0]) {
    const sample = sampleStartup(frozen, time);
    assert.notEqual(sample.state, live);
    assert.notEqual(sample.state.code, live.code);
    assert(sample.state.players.every((p) => p.id !== player.id));
  }
  createStartupShowcase();
  assert.deepEqual(live, before);
  assert.deepEqual(frozen, copy);
});

test("the opening has a real 30-second clock, gated fade, two throws and late UI fade", () => {
  assert.equal(STARTUP_DURATION_MS, 30000);
  assert.equal(showcase.duration, STARTUP_DURATION_MS);
  const start = sampleStartup(showcase, -100);
  assert.equal(start.elapsed, 0);
  assert.equal(start.phase, "materials");
  assert.equal(start.fade, 0);
  assert.equal(start.uiOpacity, 0);
  assert.equal(start.done, false);
  assert(sampleStartup(showcase, STARTUP_FADE_MS / 2).fade > 0);
  assert(sampleStartup(showcase, STARTUP_FADE_MS / 2).fade < 1);
  assert.equal(sampleStartup(showcase, STARTUP_FADE_MS).fade, 1);
  assert.equal(sampleStartup(showcase, 3799).phase, "materials");
  assert.equal(sampleStartup(showcase, 3800).phase, "table");
  for (const stage of rollingStages) {
    assert.equal(sampleStartup(showcase, stage.at).phase, "dice");
    assert.equal(sampleStartup(showcase, stage.at + 2999).phase, "dice");
    assert.notEqual(sampleStartup(showcase, stage.at + 3000).phase, "dice");
    const settled = showcase.stages.find(({ at }) => at === stage.at + 3000);
    const slot = settled.state.lastRoll.presentation.slots[0];
    assert.equal(
      sampleStartup(showcase, slot.transferAt + 300).phase,
      "payout",
    );
  }
  assert.equal(sampleStartup(showcase, STARTUP_UI_AT).uiOpacity, 0);
  const fading = sampleStartup(showcase, (STARTUP_UI_AT + 30000) / 2);
  assert(fading.uiOpacity > 0 && fading.uiOpacity < 1);
  assert.equal(sampleStartup(showcase, 29999).done, false);
  const end = sampleStartup(showcase, 30000);
  assert.equal(end.done, true);
  assert.equal(end.uiOpacity, 1);
  assert.equal(end.fade, 1);
  assert.equal(sampleStartup(showcase, 60000).elapsed, 30000);
});

test("reduced motion holds a static camera without changing dice, payouts or duration", () => {
  let fixed;
  for (const time of [0, 4000, 7000, 11000, 19500, 24000, 30000]) {
    const normal = sampleStartup(showcase, time);
    const reduced = sampleStartup(showcase, time, { reducedMotion: true });
    fixed ||= reduced.camera;
    assert.deepEqual(reduced.camera, fixed);
    assert.equal(reduced.state, normal.state);
    assert.deepEqual(reduced.pose, normal.pose);
    assert.equal(reduced.done, normal.done);
    assert.equal(reduced.uiOpacity, normal.uiOpacity);
  }
});

const recommended = {
  fps: 60,
  resolutionScale: 0.9,
  antialias: true,
  modelDetail: "auto",
  textureLimit: 4096,
};
const frames = (ms) => Array(24).fill(ms);

test("automatic quality ramps resolution, model detail and texture caps without mutation", () => {
  const before = structuredClone(recommended);
  const candidates = startupCandidates(recommended);
  assert.deepEqual(STARTUP_PROBE_AT, [0, 6500, 14000, 22500]);
  assert.deepEqual(
    candidates.map((p) => p.textureLimit),
    [1024, 2048, 4096],
  );
  candidates.forEach((candidate, index) =>
    assert(
      Math.abs(
        candidate.resolutionScale -
          recommended.resolutionScale * [0.65, 0.82, 1][index],
      ) < 1e-12,
    ),
  );
  assert.equal(candidates[0].modelDetail, "optimized");
  assert.equal(candidates[2].modelDetail, "auto");
  assert.deepEqual(recommended, before);
  const software = startupCandidates(
    { ...recommended, fps: 24 },
    { software: true },
  );
  assert(software.every((p) => p.fps === 24 && p.resolutionScale === 0.9));
  assert.notEqual(software[0], software[1]);
});

test("calibration chooses the highest stable candidate at the requested frame budget", () => {
  const candidates = startupCandidates(recommended);
  const reports = [frames(17), frames(19), frames(31)];
  assert.deepEqual(selectStartupProfile(candidates, reports), candidates[1]);
  assert.deepEqual(
    selectStartupProfile(candidates, reports, { requestedFps: 30 }),
    { ...candidates[2], fps: 30 },
  );
  assert.deepEqual(
    selectStartupProfile(candidates, [frames(50), frames(48), frames(51)], {
      requestedFps: 24,
    }),
    { ...candidates[2], fps: 24 },
  );
  const slow = selectStartupProfile(candidates, [
    frames(80),
    frames(90),
    frames(100),
  ]);
  assert.equal(slow.fps, 24);
  assert(slow.resolutionScale < candidates[0].resolutionScale);
  assert.deepEqual(
    selectStartupProfile(candidates, [[], [], []]),
    candidates[0],
  );
  assert.deepEqual(
    probeStatistics([NaN, -1, Infinity, 0, 3000, ...frames(16)]),
    { count: 24, p80: 16 },
  );
  assert.equal(probeStatistics([16, 17]), null);
});

test("manual FPS, resolution, AA, model and textures survive the startup ramp", () => {
  const candidates = startupCandidates(recommended);
  const auto = selectStartupProfile(candidates, [
    frames(70),
    frames(80),
    frames(90),
  ]);
  for (const fps of [24, 30, 60]) {
    const effective = resolveGraphics(
      {
        fps,
        resolution: "150",
        antialias: "off",
        modelDetail: "full",
        textures: "native",
      },
      auto,
      { devicePixelRatio: 2, maxTextureSize: 8192 },
    );
    assert.deepEqual(effective, {
      fps,
      pixelRatio: 3,
      resolutionScale: 1.5,
      antialias: false,
      modelDetail: "full",
      textureLimit: 8192,
    });
  }
  const software = startupCandidates(recommended, { software: true });
  assert.deepEqual(
    selectStartupProfile(software, [frames(500)], { software: true }),
    software[0],
  );
});
