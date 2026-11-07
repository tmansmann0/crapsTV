import test from "node:test";
import assert from "node:assert/strict";
import {
  retainLiveCalibrationCamera,
  markLiveCalibrationPresented,
} from "../src/live-calibration-camera.js";

const hold = () => ({
  throwId: "throw1",
  startAt: 0,
  switchAt: 300,
  endAt: 1033,
  switchedAt: 300,
  recoveryUntil: 1033,
  recoveryPresented: false,
});
const state = Object.freeze({
  rolling: false,
  aim: null,
  nextRollAt: 12345,
  throw: Object.freeze({ id: "throw1", startAt: 0, settledAt: 100 }),
});
const retain = (shot, now, next = state) =>
  retainLiveCalibrationCamera(shot, { now, roomNow: now, state: next });

test("live camera presents recovery after a fast first frame and stalled second frame", () => {
  const shot = hold();
  assert(retain(shot, 333));
  markLiveCalibrationPresented(shot, 333);
  assert.equal(shot.recoveryPresented, false);
  assert(retain(shot, 2333), "expired camera holds one actual recovery draw");
  assert.equal(shot.recoveryPresented, false, "a RAF decision is not a draw");
  markLiveCalibrationPresented(shot, 2333);
  assert.equal(shot.recoveryPresented, true);
  assert.equal(
    retain(shot, 2366),
    false,
    "following frame releases the camera",
  );
  assert.equal(state.nextRollAt, 12345, "authority cooldown remains untouched");
});

test("new aiming, flight or throw identity immediately cancels even unpresented recovery", () => {
  for (const next of [
    { ...state, aim: { active: true } },
    { ...state, rolling: true },
    { ...state, throw: { ...state.throw, id: "throw2" } },
    { ...state, throw: null },
  ]) {
    const shot = hold();
    assert.equal(retain(shot, 333, next), false);
    assert.equal(shot.recoveryPresented, false);
    assert.equal(next.nextRollAt, 12345);
  }
});

test("a skipped RAF cannot expire an unvisited safe camera lead, but unsafe payout cancels it", () => {
  const shot = hold();
  delete shot.switchedAt;
  delete shot.recoveryUntil;
  assert(retain(shot, 2500), "safe late frame can apply the requested probe");
  assert.equal(
    retain(shot, 2500, {
      ...state,
      lastRoll: { presentation: { startAt: 2000, endAt: 3000 } },
    }),
    false,
  );
});

test("normal recovery preserves its bounded camera timeout and yields to active payouts afterward", () => {
  const shot = hold();
  markLiveCalibrationPresented(shot, 500);
  assert(retain(shot, 500));
  assert.equal(retain(shot, 1050), false);
  shot.endAt = 1500;
  assert.equal(
    retain(shot, 1050, {
      ...state,
      lastRoll: { presentation: { startAt: 1000, endAt: 2000 } },
    }),
    false,
  );
});
