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
// A known cylinder overlaps the right launch position independently of any
// artwork-driven wager-coordinate changes.
const obstruction = {
  id: "launch-clearance-regression",
  position: [0.74, 0.214, 1.9],
  radius: 0.16,
  height: 0.4,
};
const obstructedProps = { ...props, stacks: [...props.stacks, obstruction] };

test("launch clears a nearby tall stack before the first physics step", () => {
  const physics = createDicePhysics(obstructedProps);
  physics.throwDice(0, gesture);
  const right = physics.bodies[1];
  assert(
    right.position.y - DIE_BOUNDING_RADIUS >
      obstruction.position[1] + obstruction.height / 2,
  );
  assert.equal(right.position.x, 0.74);
  assert.equal(right.position.z, 1.9);
  physics.step(1 / 120);
  assert.equal(
    physics.propContacts.length,
    0,
    "no correction impulse from spawning inside a stack",
  );
});

test("aim previews and authoritative launch positions use identical prop clearance", () => {
  for (const sceneProps of [props, obstructedProps])
    for (const x of [-1, 0, 1])
      for (const power of [0, 0.5, 1]) {
        const input = { x, power },
          physics = createDicePhysics(sceneProps);
        physics.throwDice(15, input);
        const positions = physics.bodies.map((body) => body.position.toArray());
        assert.deepEqual(
          aimDicePose(input, sceneProps).dice.map((die) => die.position),
          positions,
        );
        assert.deepEqual(diceLaunchPositions(input, sceneProps), positions);
      }
});

test("clearance consumes no RNG values and changes only the obstructed launch height", () => {
  const clear = createDicePhysics(),
    obstructed = createDicePhysics(obstructedProps);
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
