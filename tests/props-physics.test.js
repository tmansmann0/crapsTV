import test from "node:test";
import assert from "node:assert/strict";
import { createDicePhysics, MAX_WAGER_COLLIDERS } from "../src/dice-physics.js";
import {
  createThrowTimeline,
  sampleThrow,
  upperDieFace,
} from "../src/throw-motion.js";
import {
  puckHome,
  PUCK_HEIGHT,
  PUCK_RADIUS,
  PUCK_MASS,
} from "../src/puck-layout.js";
import { wagerStackLayout } from "../src/wager-layout.js";
import * as game from "../src/game.js";

const marker = { ...puckHome(9), position: [0, PUCK_HEIGHT / 2 + 0.002, 0] };
const options = {
  id: "props",
  playerId: "shooter",
  seed: 39,
  startAt: 1000,
  gesture: { x: 0, power: 0.65 },
};
function directHit(props = {}) {
  const physics = createDicePhysics(props);
  physics.throwDice(1);
  physics.bodies.forEach((body, i) => {
    body.position.set(i ? 4 : -0.65, 0.14, 0);
    body.quaternion.set(0, 0, 0, 1);
    body.velocity.set(i ? 0 : 8, 0, 0);
    body.angularVelocity.set(0, 0, 0);
  });
  for (let i = 0; i < 180; i++) physics.step(1 / 120);
  return physics;
}

test("puck matches modeled dimensions and rests just above felt with ON/OFF orientation", () => {
  assert.equal(PUCK_RADIUS, 0.2);
  assert.equal(PUCK_HEIGHT, 0.085);
  assert.equal(PUCK_MASS, 0.18);
  assert.equal(puckHome(6).position[1], PUCK_HEIGHT / 2 + 0.002);
  assert.deepEqual(puckHome(6).quaternion, [0, 0, 0, 1]);
  assert.deepEqual(puckHome(null).quaternion, [1, 0, 0, 0]);
  assert.notEqual(puckHome(4).position[0], puckHome(10).position[0]);
});

test("a physical puck deflects dice and receives a real movement impulse", () => {
  const empty = directHit(),
    hit = directHit({ puck: marker });
  assert.equal(hit.puckBody.mass, PUCK_MASS);
  assert(
    hit.propContacts.some(
      (contact) => contact.kind === "puck" && contact.speed > 1,
    ),
  );
  assert(
    hit.puckBody.position.distanceTo({ x: 0, y: PUCK_HEIGHT / 2, z: 0 }) > 0.01,
  );
  assert(Math.abs(empty.bodies[0].position.x - hit.bodies[0].position.x) > 0.2);
});

test("solid wager stacks stop dice at their geometry and emit bounded real contacts", () => {
  const stack = {
    id: "wager:alice:pass",
    position: [0, 0.214, 0],
    radius: 0.16,
    height: 0.4,
  };
  const empty = directHit(),
    hit = directHit({ stacks: [stack] });
  assert(empty.bodies[0].position.x > 0);
  assert(hit.bodies[0].position.x < -0.16);
  assert.equal(hit.stackBodies.length, 1);
  assert(hit.propContacts.length > 0 && hit.propContacts.length <= 128);
  const contact = hit.propContacts[0];
  assert.equal(contact.id, stack.id);
  assert.equal(contact.kind, "stack");
  assert.equal(contact.die, 0);
  assert(contact.speed > 1);
  assert(Math.abs(Math.hypot(...contact.normal) - 1) < 1e-6);
  assert.throws(() =>
    createDicePhysics({ stacks: Array(MAX_WAGER_COLLIDERS + 1).fill(stack) }),
  );
  assert.throws(() =>
    createDicePhysics({ stacks: [{ ...stack, position: [NaN, 0, 0] }] }),
  );
});

test("puck and dice share one deterministic timeline and never reorient after rest", () => {
  const flight = createThrowTimeline({ ...options, puck: marker });
  const second = createThrowTimeline({ ...options, puck: marker });
  const baseline = createThrowTimeline(options);
  assert.deepEqual(flight, second);
  assert.notDeepEqual(flight.frames, baseline.frames);
  assert(flight.propHits > 0);
  assert.equal(flight.puckFrames.length, flight.frames.length);
  for (let i = 0; i < flight.frames.length; i++)
    assert.equal(flight.puckFrames[i][0], flight.frames[i][0]);
  const wire = JSON.parse(JSON.stringify(flight));
  for (const at of [1000, 1144, 1600, 2400, 3500, 9000])
    assert.deepEqual(sampleThrow(flight, at), sampleThrow(wire, at));
  const end = sampleThrow(flight, 3500),
    later = sampleThrow(flight, 9000);
  assert.deepEqual(end, later);
  assert.deepEqual(
    flight.puckFrames.at(-1).slice(1),
    flight.puckFrames.at(-2).slice(1),
  );
  end.dice.forEach((die, index) =>
    assert.equal(upperDieFace(die.quaternion).value, flight.dice[index]),
  );
  assert.deepEqual(end.puck.position, flight.puckFrames.at(-1).slice(1, 4));
});

test("each puck frame is the unmodified authoritative Cannon pose", () => {
  const flight = createThrowTimeline({ ...options, puck: marker }),
    physics = createDicePhysics({ puck: marker });
  physics.throwDice(options.seed, options.gesture);
  for (let i = 0; i < flight.puckFrames.length - 1; i++) {
    if (i) {
      physics.step(1 / 120);
      physics.step(1 / 120);
    }
    const b = physics.puckBody;
    const pose = [
      b.position.x,
      b.position.y,
      b.position.z,
      b.quaternion.x,
      b.quaternion.y,
      b.quaternion.z,
      b.quaternion.w,
    ].map((n) => Math.round(n * 100000) / 100000);
    assert.deepEqual(flight.puckFrames[i].slice(1), pose);
  }
  assert(physics.sleeping);
});

test("game uses its own puck/wager state and retains or resets the puck at settlement", () => {
  const s = game.createState(),
    player = game.join(s, "Alice");
  game.configure(s, player.id, { rollCooldownSeconds: 0 });
  game.start(s, player.id);
  s.point = 9;
  s.puck = structuredClone(marker);
  s.throw = createThrowTimeline({ ...options, puck: marker });
  s.rolling = true;
  const final = s.throw.puckFrames.at(-1).slice(1, 4);
  game.finishRoll(s);
  assert.equal(s.point, 9);
  assert.deepEqual(s.puck.position, final);
  game.place(s, player.id, "field", 500);
  const puckBefore = structuredClone(s.puck),
    stacksBefore = wagerStackLayout(s);
  game.beginRoll(s, player.id);
  assert.deepEqual(s.throw.props.puck, puckBefore);
  assert.deepEqual(s.throw.props.stacks, stacksBefore);
  // A trusted rules fixture changes the point; it must reset the marker's face.
  game.finishRoll(s, [3, 3]);
  s.point = 6;
  s.throw = createThrowTimeline({ ...options, seed: 24, puck: marker });
  s.rolling = true;
  game.finishRoll(s);
  assert.equal(s.point, null);
  assert.deepEqual(s.puck, puckHome(null));
});

test("actual point-eight puck position receives physical contact from an ordinary launch", () => {
  const puck = puckHome(8);
  const flight = createThrowTimeline({
    ...options,
    seed: 3,
    gesture: { x: 0, power: 0 },
    puck,
  });
  assert(flight.propContacts.some((contact) => contact.kind === "puck"));
  const end = sampleThrow(flight, flight.startAt + flight.duration);
  assert(
    Math.hypot(
      end.puck.position[0] - puck.position[0],
      end.puck.position[2] - puck.position[2],
    ) > 0.004,
  );
});

test("real field stack produces serialized authority contact metadata on the same timeline", () => {
  const state = {
    config: { mode: "craps" },
    players: [
      {
        id: "alice",
        seat: 0,
        bets: [{ id: "field-proof", type: "field", amount: 1900 }],
      },
    ],
  };
  const stacks = wagerStackLayout(state);
  const flight = createThrowTimeline({
    ...options,
    seed: 1,
    gesture: { x: -0.5, power: 0 },
    puck: puckHome(null),
    stacks,
  });
  assert(flight.stackContacts.length > 0);
  const contact = flight.stackContacts[0];
  assert.equal(contact.stackId, stacks[0].id);
  assert(contact.time >= 0 && contact.time <= flight.duration);
  assert(contact.speed > 1);
  assert(contact.normal.every(Number.isFinite));
  assert.equal(
    JSON.parse(JSON.stringify(flight)).stackContacts[0].stackId,
    stacks[0].id,
  );
});
