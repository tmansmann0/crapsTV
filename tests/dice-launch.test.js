import test from "node:test";
import assert from "node:assert/strict";
import {
  diceLaunchPositions,
  DIE_BOUNDING_RADIUS,
} from "../src/dice-launch.js";
import { createDicePhysics } from "../src/dice-physics.js";
import { aimDicePose } from "../src/throw-motion.js";
import { wagerStackLayout } from "../src/wager-layout.js";
import { puckHome } from "../src/puck-layout.js";

const gesture = { x: 1, power: 0 };
const state = {
  config: { mode: "craps" },
  players: [
    {
      id: "p3",
      seat: 3,
      bets: [
        { id: "line", type: "pass", point: 6, amount: 1900 },
        { id: "odds", type: "odds", point: 6, parent: "line", amount: 1900 },
      ],
    },
  ],
};
const props = { puck: puckHome(6), stacks: wagerStackLayout(state) };

test("launch clears the reproduced tall pass-odds stack before the first physics step", () => {
  const odds = props.stacks[1],
    physics = createDicePhysics(props);
  physics.throwDice(0, gesture);
  const right = physics.bodies[1];
  assert(
    right.position.y - DIE_BOUNDING_RADIUS > odds.position[1] + odds.height / 2,
  );
  assert.equal(right.position.x, 0.74);
  assert.equal(right.position.z, 1.9);
  physics.step(1 / 120);
  assert.equal(
    physics.propContacts.length,
    0,
    "no correction impulse from spawning inside the odds stack",
  );
});

test("aim previews and authoritative launch positions use identical prop clearance", () => {
  for (const x of [-1, 0, 1])
    for (const power of [0, 0.5, 1]) {
      const input = { x, power },
        physics = createDicePhysics(props);
      physics.throwDice(15, input);
      const positions = physics.bodies.map((body) => body.position.toArray());
      assert.deepEqual(
        aimDicePose(input, props).dice.map((die) => die.position),
        positions,
      );
      assert.deepEqual(diceLaunchPositions(input, props), positions);
    }
});

test("clearance consumes no RNG values and changes only the obstructed launch height", () => {
  const clear = createDicePhysics(),
    obstructed = createDicePhysics(props);
  clear.throwDice(0, gesture);
  obstructed.throwDice(0, gesture);
  for (let i = 0; i < 2; i++) {
    assert.deepEqual(
      obstructed.bodies[i].quaternion.toArray(),
      clear.bodies[i].quaternion.toArray(),
    );
    assert.deepEqual(
      obstructed.bodies[i].velocity.toArray(),
      clear.bodies[i].velocity.toArray(),
    );
    assert.deepEqual(
      obstructed.bodies[i].angularVelocity.toArray(),
      clear.bodies[i].angularVelocity.toArray(),
    );
    assert.equal(obstructed.bodies[i].position.x, clear.bodies[i].position.x);
    assert.equal(obstructed.bodies[i].position.z, clear.bodies[i].position.z);
  }
  assert.equal(obstructed.bodies[0].position.y, clear.bodies[0].position.y);
  assert(obstructed.bodies[1].position.y > clear.bodies[1].position.y);
  assert.deepEqual(diceLaunchPositions(gesture), [
    [0.55 - 0.19, 0.23, 1.9],
    [0.74, 0.26, 1.9],
  ]);
});
