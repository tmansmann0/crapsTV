import test from "node:test";
import assert from "node:assert/strict";
import * as game from "../src/game.js";
import { RoomHub } from "../src/hub.js";
import {
  createThrowTimeline,
  sampleThrow,
  diceQuaternion,
  aimDicePose,
  sanitizeGesture,
} from "../src/throw-motion.js";
import { DICE_SIZE, BOUNDS } from "../src/dice-physics.js";

const options = {
  id: "test-throw",
  playerId: "shooter",
  shooterId: "shooter",
  seed: 8214,
  dice: [2, 5],
  startAt: 10000,
  duration: 2500,
  gesture: { x: 0.3, power: 0.7 },
};
function table() {
  const state = game.createState("TESTAB");
  const a = game.join(state, "Alice"),
    b = game.join(state, "Bob");
  game.start(state, a.id);
  return { state, a, b };
}

test("teach mode starts off and only a valid host can enable it", () => {
  const { state, a, b } = table();
  assert.equal(state.config.teach, false);
  assert.throws(() => game.setTeach(state, b.id, true));
  game.setTeach(state, a.id, true);
  assert.equal(state.config.teach, true);
});

test("aim requires the shooter or admin and clamps finite coordinates", () => {
  const { state, a, b } = table();
  assert.throws(() => game.setAim(state, b.id, { x: 0, power: 0.5 }));
  for (const input of [{ x: NaN }, { power: Infinity }, { x: "0" }, null, []])
    assert.throws(() => game.setAim(state, a.id, input));
  assert.equal(game.setAim(state, a.id, { x: 100, power: -3 }, 1000), true);
  assert.deepEqual(state.aim, {
    playerId: a.id,
    x: 1,
    power: 0,
    active: true,
    at: 1000,
  });
  assert.equal(game.setAim(state, a.id, { x: -1, power: 1 }, 1050), false);
  assert.equal(state.aim.x, 1);
  assert.equal(game.setAim(state, a.id, { x: -1, power: 1 }, 1100), true);
  assert.equal(state.aim.x, -1);
  game.setAim(state, a.id, { active: false }, 1110);
  assert.equal(state.aim, null);
  const pose = aimDicePose({ x: 1, power: 1 });
  assert.equal(pose.dice.length, 2);
  assert(pose.direction[0] > 0 && pose.direction[2] < 0);
  assert.equal(DICE_SIZE, 0.22);
});

test("release freezes the gesture and chooses an authoritative outcome before settlement", () => {
  const { state, a } = table();
  game.setAim(state, a.id, { x: 0.4, power: 0.8 }, 1000);
  const flight = game.beginRoll(state, a.id, undefined, { duration: 2500 });
  assert.equal(state.aim, null);
  assert(state.rolling);
  assert.equal(state.lastRoll, null);
  assert.deepEqual(flight.gesture, { x: 0.4, power: 0.8 });
  assert.throws(() => game.setAim(state, a.id, { x: 0, power: 0 }));
  assert.throws(() => game.beginRoll(state, a.id));
  const chosen = [...flight.dice];
  game.finishRoll(state);
  assert.deepEqual(state.lastRoll.dice, chosen);
  assert.equal(state.lastRoll.throwId, flight.id);
  assert.equal(state.throw.id, flight.id); // kept for the shared settled pose
  assert.equal(state.rolling, false);
});

test("a precomputed timeline is deterministic and clients can seek at independent cadences", () => {
  const first = createThrowTimeline(options),
    second = createThrowTimeline(options);
  assert.deepEqual(first, second);
  const wireCopy = JSON.parse(JSON.stringify(first));
  for (const t of [0, 10000, 10121.5, 11220, 11999, 12500, 999999])
    assert.deepEqual(sampleThrow(first, t), sampleThrow(wireCopy, t));
  // A slow TV and a fast phone may sample arbitrary timestamps without changing
  // what either will see when they next ask for the same server time.
  for (let t = 10000; t < 11220; t += 16) sampleThrow(first, t);
  for (let t = 10000; t < 11220; t += 250) sampleThrow(wireCopy, t);
  assert.deepEqual(sampleThrow(first, 11220), sampleThrow(wireCopy, 11220));
  assert.equal(sampleThrow(first, 9999).progress, 0);
  assert.equal(sampleThrow(first, 12500).done, true);
  assert.equal(first.frames.length, 151);
  assert(first.wallHits > 0);
});

function rotate(v, q) {
  const [x, y, z, w] = q,
    [vx, vy, vz] = v;
  const tx = 2 * (y * vz - z * vy),
    ty = 2 * (z * vx - x * vz),
    tz = 2 * (x * vy - y * vx);
  return [
    vx + w * tx + y * tz - z * ty,
    vy + w * ty + z * tx - x * tz,
    vz + w * tz + x * ty - y * tx,
  ];
}
const faces = {
  1: [0, 1, 0],
  2: [0, 0, 1],
  3: [1, 0, 0],
  4: [-1, 0, 0],
  5: [0, 0, -1],
  6: [0, -1, 0],
};
test("the conditioned final orientation always shows the authoritative face", () => {
  for (let value = 1; value <= 6; value++) {
    const up = rotate(faces[value], diceQuaternion(value, 1.1));
    assert(
      Math.abs(up[0]) < 1e-9 &&
        Math.abs(up[1] - 1) < 1e-9 &&
        Math.abs(up[2]) < 1e-9,
    );
    const flight = createThrowTimeline({
      ...options,
      dice: [value, 7 - value],
    });
    const end = sampleThrow(flight, 12500);
    for (let i = 0; i < 2; i++) {
      const renderedUp = rotate(faces[flight.dice[i]], end.dice[i].quaternion);
      assert(Math.abs(renderedUp[1] - 1) < 0.0001);
      assert.equal(end.dice[i].position[1], DICE_SIZE / 2 + 0.002);
    }
  }
});

test("extreme allowed gestures keep dice within the cushion and above the felt", () => {
  for (const x of [-1, 0, 1])
    for (const power of [0, 1]) {
      const flight = createThrowTimeline({ ...options, gesture: { x, power } });
      for (const frame of flight.frames)
        for (const start of [1, 8]) {
          assert(Math.abs(frame[start]) < BOUNDS.x + 0.22);
          assert(Math.abs(frame[start + 2]) < BOUNDS.z + 0.22);
          assert(frame[start + 1] > -0.05);
        }
    }
});

test("hub transports include clock timestamps and reject forged throw outcomes", async () => {
  const hub = new RoomHub("TESTAB", { rollDelay: 20 });
  const messages = [];
  hub.connect("alice", (message) => messages.push(message));
  assert(Number.isFinite(messages[0].sentAt));
  hub.receive("alice", { type: "join", code: "TESTAB", name: "Alice" });
  hub.receive("alice", { type: "start" });
  hub.receive("alice", { type: "aim", aim: { x: -4, power: 4 } });
  assert.equal(hub.state.aim.x, -1);
  hub.receive("alice", {
    type: "roll",
    gesture: { x: 0, power: 0.4 },
    seed: -1,
    dice: [9, 9],
  });
  assert.equal(hub.state.throw.duration, 20);
  assert(hub.state.throw.seed >= 0);
  assert(hub.state.throw.dice.every((n) => n >= 1 && n <= 6));
  assert.equal(hub.state.lastRoll, null);
  const chosen = [...hub.state.throw.dice];
  await new Promise((resolve) => setTimeout(resolve, 45));
  assert.deepEqual(hub.state.lastRoll.dice, chosen);
  assert.equal(hub.state.rolling, false);
  assert(
    messages
      .filter((m) => m.type === "state")
      .every((m) => Number.isFinite(m.sentAt)),
  );
  hub.close();
});

test("aim clears on disconnect or cashout and bad gestures never lock betting", () => {
  const { state, a } = table();
  game.setAim(state, a.id, { x: 0.2, power: 0.2 });
  game.changeConnection(state, a.id, false);
  assert.equal(state.aim, null);
  game.changeConnection(state, a.id, true);
  assert.throws(() => game.beginRoll(state, a.id, { x: Infinity }));
  assert.equal(state.rolling, false);
  game.setAim(state, a.id, { x: 0.2, power: 0.2 });
  game.leave(state, a.id);
  assert.equal(state.aim, null);
  assert.deepEqual(sanitizeGesture(), { x: 0, power: 0.65 });
});

test("clock pings work before joining without changing or broadcasting state", () => {
  const hub = new RoomHub("CLOCKA");
  const first = [],
    second = [];
  hub.connect("one", (message) => first.push(message));
  hub.connect("two", (message) => second.push(message));
  const initialState = structuredClone(hub.state);
  const before = Date.now();
  hub.receive("one", { type: "clock", clientAt: 123456.5 });
  const response = first.at(-1);
  assert.deepEqual(Object.keys(response).sort(), [
    "clientAt",
    "serverAt",
    "type",
  ]);
  assert.equal(response.type, "clock");
  assert.equal(response.clientAt, 123456.5);
  assert(response.serverAt >= before && response.serverAt <= Date.now());
  assert.equal(first.length, 2);
  assert.equal(second.length, 1);
  assert.deepEqual(hub.state, initialState);
  for (const clientAt of [undefined, null, "1", NaN, Infinity, -Infinity, {}]) {
    hub.receive("one", { type: "clock", clientAt });
    assert.equal(first.at(-1).type, "error");
    assert.equal(first.at(-1).message, "Invalid clock timestamp.");
  }
  assert.equal(second.length, 1);
  assert.deepEqual(hub.state, initialState);
  hub.close();
});
