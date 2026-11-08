import test from "node:test";
import assert from "node:assert/strict";
import {
  createAutoEffects,
  autoEffectEligibility,
  autoEffectFrameBudget,
} from "../src/auto-effects.js";
const caps = {
  deviceMemory: 8,
  maxTextureSize: 8192,
  maxCubemapSize: 4096,
  software: false,
};
function rig(options = {}) {
  const config = {
    capabilities: caps,
    targetFps: 60,
    choices: {
      lensFlares: "auto",
      localReflections: "auto",
      contactShadows: "auto",
    },
    ...options,
  };
  const controller = createAutoEffects(config);
  let time = 0,
    state = controller.describe();
  function tick(patch = {}) {
    time += patch.frameMs ?? 1000 / 60;
    state = controller.update({
      time,
      frameMs: 1000 / 60,
      safe: true,
      visible: true,
      ready: true,
      testing: false,
      resourcesReady: true,
      lampVisible: false,
      ...patch,
    });
    return state;
  }
  function run(count, patch = {}) {
    for (let i = 0; i < count; i++)
      tick(typeof patch === "function" ? patch(state) : patch);
    return state;
  }
  function until(predicate, patch = {}, limit = 2000) {
    for (let i = 0; i < limit; i++) {
      if (predicate(state)) return state;
      tick(typeof patch === "function" ? patch(state) : patch);
    }
    assert.fail(`policy never reached expected state: ${state.phase}`);
  }
  return {
    controller,
    tick,
    run,
    until,
    config,
    get state() {
      return state;
    },
  };
}

test("eligibility declines software/low-memory heavy effects, unknown memory keeps contact shadows conservative", () => {
  assert.deepEqual(autoEffectEligibility({ capabilities: caps }), {
    lensFlares: true,
    localReflections: true,
    contactShadows: true,
  });
  assert.deepEqual(
    autoEffectEligibility({ capabilities: { ...caps, software: true } }),
    { lensFlares: false, localReflections: false, contactShadows: false },
  );
  assert.deepEqual(
    autoEffectEligibility({ capabilities: { ...caps, deviceMemory: 4 } }),
    { lensFlares: true, localReflections: false, contactShadows: false },
  );
  assert.deepEqual(
    autoEffectEligibility({
      capabilities: { ...caps, deviceMemory: undefined },
    }),
    { lensFlares: true, localReflections: true, contactShadows: false },
  );
  assert.deepEqual(
    autoEffectEligibility({
      capabilities: caps,
      supported: { localReflections: false, contactShadows: false },
    }),
    { lensFlares: true, localReflections: false, contactShadows: false },
  );
});

test("actual24/30/60 FPS cadence is quantized to the display, avoiding a false24FPS failure", () => {
  assert.equal(autoEffectFrameBudget(24), 50);
  assert.equal(autoEffectFrameBudget(30), 1000 / 30);
  assert.equal(autoEffectFrameBudget(60), 1000 / 60);
  assert.equal(autoEffectFrameBudget(24, 120), 1000 / 24);
  const r = rig({ targetFps: 24 });
  r.until((s) => s.phase === "accepted", { frameMs: 50 });
  assert.equal(r.state.reports[0].p80, 50);
  assert.equal(r.state.flags.localReflections, true);
});

test("qualification starts Off, requires45baseline plus completed resources and750ms warm wait then60trial frames", () => {
  const r = rig();
  assert.deepEqual(r.controller.flags, {
    lensFlares: false,
    localReflections: false,
    contactShadows: false,
  });
  r.until((s) => s.phase === "warming");
  assert.equal(r.state.baselineSamples, 45);
  assert.equal(r.state.trialSamples, 0);
  assert.equal(r.state.flags.localReflections, true);
  assert.equal(r.state.flags.contactShadows, true);
  r.run(15, { resourcesReady: false, frameMs: 150 });
  assert.equal(r.state.trialSamples, 0);
  r.run(30);
  assert.equal(r.state.phase, "warming");
  assert.equal(r.state.trialSamples, 0);
  r.until((s) => s.phase === "trial");
  r.until((s) => s.phase === "accepted");
  assert.deepEqual(
    r.state.reports.map((x) => [x.baselineSamples, x.trialSamples]),
    [[45, 60]],
  );
  assert.equal(
    r.state.flags.lensFlares,
    false,
    "unseen lamps cannot justify a zero-cost flare pass",
  );
  assert.equal(r.state.deferredLens, true);
});

test("manual On/Off bypass capability and qualification and never get overridden", () => {
  const r = rig({
    capabilities: { ...caps, software: true },
    choices: {
      lensFlares: "on",
      localReflections: "off",
      contactShadows: "on",
    },
  });
  assert.deepEqual(r.controller.flags, {
    lensFlares: true,
    localReflections: false,
    contactShadows: true,
  });
  r.run(400, { safe: false, frameMs: 100 });
  r.run(10);
  assert.deepEqual(r.state.flags, {
    lensFlares: true,
    localReflections: false,
    contactShadows: true,
  });
  assert.equal(r.state.phase, "manual");
  assert.equal(r.state.reports.length, 0);
});

test("failed full candidate falls back to reflections without contact shadows, never touching base quality", () => {
  const r = rig();
  r.until(
    (s) => s.phase === "accepted",
    (s) => ({
      frameMs: s.phase === "trial" && s.flags.contactShadows ? 26 : 1000 / 60,
    }),
  );
  assert.deepEqual(r.state.flags, {
    lensFlares: false,
    localReflections: true,
    contactShadows: false,
  });
  assert.deepEqual(
    r.state.reports.map((x) => x.accepted),
    [false, true],
  );
  assert.equal(r.state.reports[0].p80, 26);
  assert.equal(r.config.targetFps, 60);
  assert(!Object.hasOwn(r.state, "resolutionScale"));
});

test("failed heavy qualification does not retry on later faster frames until Retest", () => {
  const r = rig();
  r.until(
    (s) => s.phase === "limited" && s.reports.length === 2,
    (s) => ({ frameMs: s.phase === "trial" ? 30 : 1000 / 60 }),
  );
  r.run(500);
  assert.equal(r.state.reports.length, 2);
  assert.equal(r.state.flags.localReflections, false);
  const generation = r.state.generation;
  r.controller.retest();
  r.until((s) => s.phase === "accepted");
  assert.equal(r.state.generation, generation + 1);
  assert.equal(r.state.flags.contactShadows, true);
});

test("visible flares receive a separate real-lamp baseline/trial after heavy qualification", () => {
  const r = rig();
  r.until((s) => s.phase === "accepted");
  r.run(100, { lampVisible: false });
  assert.equal(r.state.flags.lensFlares, false);
  assert.equal(r.state.reports.length, 1);
  r.until((s) => s.phase === "lens-warming", { lampVisible: true });
  assert.equal(r.state.flags.lensFlares, true);
  assert.equal(r.state.baselineSamples, 45);
  r.until((s) => s.phase === "accepted" && s.reports.length === 2, {
    lampVisible: true,
  });
  assert.equal(r.state.flags.lensFlares, true);
  assert.equal(r.state.reports[1].kind, "lens");
  assert.equal(r.state.reports[1].trialSamples, 60);
});

test("a disappearing lamp defers its incomplete trial without resetting accepted heavy effects", () => {
  const r = rig();
  r.until((s) => s.phase === "accepted");
  r.until((s) => s.phase === "lens-warming", { lampVisible: true });
  r.run(100, { frameMs: 40, lampVisible: false });
  assert.equal(r.state.flags.lensFlares, false);
  assert.equal(r.state.flags.localReflections, true);
  assert.equal(r.state.deferredLens, true);
  assert.equal(r.state.reports.length, 1);
});

test("sustained rolling/payout frame loss queues Off until safe idle and manual choices remain active", () => {
  const r = rig({
    choices: {
      lensFlares: "on",
      localReflections: "auto",
      contactShadows: "auto",
    },
  });
  r.until((s) => s.phase === "accepted");
  r.run(120, { safe: false, frameMs: 40, resourcesReady: false });
  assert.equal(r.state.pendingFallback, true);
  assert.equal(r.state.phase, "pending-off");
  assert.equal(
    r.state.flags.localReflections,
    true,
    "physics/payout cannot trigger automatic toggles",
  );
  r.run(10, { safe: false, frameMs: 40 });
  assert.equal(r.state.flags.contactShadows, true);
  r.tick({ safe: true });
  assert.deepEqual(r.state.flags, {
    lensFlares: true,
    localReflections: false,
    contactShadows: false,
  });
  r.run(300);
  assert.equal(
    r.state.flags.localReflections,
    false,
    "no automatic retry after sustained fallback",
  );
});

test("hysteresis ignores isolated slow frames and clears a single bad window after recovery", () => {
  const r = rig();
  r.until((s) => s.phase === "accepted");
  r.run(60, { frameMs: 40, safe: false });
  assert.equal(r.state.badWindows, 1);
  r.run(60, { safe: false });
  assert.equal(r.state.badWindows, 0);
  r.tick({ frameMs: 200, safe: false });
  r.run(119, { safe: false });
  assert.equal(r.state.pendingFallback, false);
  assert.equal(r.state.flags.localReflections, true);
});

test("hidden/loading/base-calibration/cold resource frames never qualify an automatic effect", () => {
  const r = rig();
  r.run(80, { visible: false, frameMs: 1000 });
  r.run(80, { ready: false });
  r.run(80, { testing: true });
  assert.equal(r.state.baselineSamples, 0);
  assert.equal(r.state.flags.contactShadows, false);
  r.until((s) => s.phase === "baseline");
  const before = r.state.baselineSamples;
  r.run(100, { warming: true, frameMs: 300 });
  assert.equal(r.state.baselineSamples, before);
  r.tick({ visible: false, frameMs: 1500 });
  r.tick({ frameMs: 1500 });
  assert.equal(
    r.state.baselineSamples,
    before,
    "first returned interval does not count hidden wall time",
  );
});

test("configure is idempotent while changed base settings and Retest queue resets until safe frames", () => {
  const r = rig();
  r.until((s) => s.phase === "accepted");
  const generation = r.state.generation;
  assert.equal(r.controller.configure({ ...r.config }).pendingReset, false);
  r.controller.configure({
    qualificationKey: "new AA/resolution/texture choice",
  });
  assert.equal(r.controller.flags.localReflections, true);
  r.run(5, { safe: false });
  assert.equal(r.state.pendingReset, true);
  assert.equal(r.state.flags.localReflections, true);
  r.tick({ safe: true });
  assert.equal(r.state.generation, generation + 1);
  assert.equal(r.state.flags.localReflections, false);
  r.until((s) => s.phase === "accepted");
  r.controller.retest();
  r.run(4, { testing: true });
  assert.equal(r.state.flags.contactShadows, true);
  r.tick();
  assert.equal(r.state.flags.contactShadows, false);
});

test("capability changes require a fresh safe qualification; invalid choices reject without mutation", () => {
  const r = rig();
  r.until((s) => s.phase === "accepted");
  r.controller.configure({ capabilities: { ...caps, deviceMemory: 4 } });
  r.tick({ safe: false });
  assert.equal(r.state.flags.localReflections, true);
  r.tick();
  r.run(5);
  assert.equal(r.state.flags.localReflections, false);
  assert.equal(r.state.flags.contactShadows, false);
  const flags = r.controller.flags;
  assert.throws(
    () => r.controller.configure({ choices: { lensFlares: "bogus" } }),
    /Invalid/,
  );
  assert.deepEqual(r.controller.flags, flags);
});

test("failed visible-flare qualification preserves previously accepted heavy effects without retrying", () => {
  const r = rig();
  r.until((s) => s.phase === "accepted");
  r.until(
    (s) => s.reports.length === 2 && s.phase === "accepted",
    (s) => ({
      lampVisible: true,
      frameMs: s.phase === "lens-trial" ? 27 : 1000 / 60,
    }),
  );
  assert.equal(r.state.flags.lensFlares, false);
  assert.equal(r.state.flags.localReflections, true);
  assert.equal(r.state.flags.contactShadows, true);
  assert.equal(r.state.reports[1].accepted, false);
  r.run(250, { lampVisible: true });
  assert.equal(r.state.reports.length, 2);
});

test("significant baseline regression rejects effects even below an absolute30FPS budget", () => {
  const r = rig({ targetFps: 30 });
  r.until(
    (s) => s.phase === "limited" && s.reports.length === 2,
    (s) => ({
      frameMs: s.phase === "trial" ? 26 : 20,
    }),
  );
  assert(26 < r.state.budgetMs * 1.15);
  assert(r.state.reports.every((record) => !record.accepted));
  assert.equal(r.state.flags.localReflections, false);
});

test("hidden intervals interrupt sustained-loss history instead of joining unrelated bad windows", () => {
  const r = rig();
  r.until((s) => s.phase === "accepted");
  r.run(60, { safe: false, frameMs: 40 });
  assert.equal(r.state.badWindows, 1);
  r.tick({ visible: false, frameMs: 1500 });
  r.tick({ frameMs: 1500, safe: false });
  r.run(60, { safe: false, frameMs: 40 });
  assert.equal(r.state.badWindows, 1);
  assert.equal(r.state.pendingFallback, false);
});
