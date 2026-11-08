import test from "node:test";
import assert from "node:assert/strict";
import { createDicePhysics } from "../src/dice-physics.js";
import { upperDieFace } from "../src/throw-motion.js";
import { DIE_BOUNDING_RADIUS } from "../src/dice-launch.js";

function flatSlide(x, z, { spin = 0, speed = 1 } = {}) {
  const physics = createDicePhysics();
  physics.throwDice(1);
  physics.bodies.forEach((body, index) => {
    body.position.set(index ? -4 : x, 0.11, index ? -2 : z);
    body.quaternion.set(0, 0, 0, 1);
    body.velocity.set(index ? 0 : speed, 0, 0);
    body.angularVelocity.set(0, index ? 0 : spin, 0);
  });
  let sleptAt = null,
    path = 0,
    latePath = 0;
  const body = physics.bodies[0],
    previous = body.position.clone();
  for (let step = 0; step < 600; step++) {
    physics.step(1 / 120);
    const distance = Math.hypot(
      body.position.x - previous.x,
      body.position.z - previous.z,
    );
    path += distance;
    if (step >= 120) latePath += distance;
    previous.copy(body.position);
    if (sleptAt === null && body.sleepState === 2) sleptAt = (step + 1) / 120;
  }
  return {
    body,
    path,
    latePath,
    sleptAt,
    dx: body.position.x - x,
    dz: body.position.z - z,
  };
}

test("a flat die brakes and sleeps without sideways creep at different table positions", () => {
  for (const [x, z] of [
    [0, 0],
    [3, 1],
    [-2, 1],
    [2, -1],
  ]) {
    const result = flatSlide(x, z);
    assert(
      result.sleptAt !== null && result.sleptAt < 1,
      `${x},${z} sleep ${result.sleptAt}`,
    );
    assert(result.path < 0.1, `${x},${z} path ${result.path}`);
    assert(
      Math.abs(result.dz) < 0.003,
      `${x},${z} unexplained sideways movement ${result.dz}`,
    );
    assert(result.latePath < 0.0001, `${x},${z} late drift ${result.latePath}`);
  }
});

test("translating the same die contact does not change the relative friction trajectory", () => {
  const right = flatSlide(3, 1),
    left = flatSlide(-2, 1);
  assert(Math.abs(right.dx - left.dx) < 0.0001);
  assert(Math.abs(right.dz - left.dz) < 0.0001);
  assert(Math.abs(right.path - left.path) < 0.0001);
  assert.equal(right.sleptAt, left.sleptAt);
});

test("distributed face contacts resist residual yaw instead of spinning for seconds", () => {
  const result = flatSlide(3, 1, { spin: 10 });
  assert(result.sleptAt !== null && result.sleptAt < 1);
  assert(result.latePath < 0.0001);
  assert.deepEqual(result.body.velocity.toArray(), [0, 0, 0]);
  assert.deepEqual(result.body.angularVelocity.toArray(), [0, 0, 0]);
  assert.equal(upperDieFace(result.body.quaternion.toArray()).value, 1);
});

test("an initially resting face receives no unforced horizontal motion", () => {
  const result = flatSlide(3, 1, { speed: 0 });
  assert(result.path < 0.001);
  assert(result.latePath < 0.0001);
  assert(result.sleptAt !== null && result.sleptAt < 1);
});

test("friction anchors stay body-local and contact count cannot multiply the force budget", () => {
  const physics = createDicePhysics();
  physics.throwDice(1);
  physics.bodies.forEach((body, index) => {
    body.position.set(index ? -4 : 3, 0.10999, index ? -2 : 1);
    body.quaternion.set(0, 0, 0, 1);
    body.velocity.set(0, 0, 0);
    body.angularVelocity.set(0, 0, 0);
  });
  physics.step(1 / 120);
  const die = physics.bodies[0];
  const equations = physics.world.frictionEquations.filter(
    (equation) => equation.bi === die || equation.bj === die,
  );
  assert(equations.length > 0);
  for (const equation of equations) {
    const arm = equation.bi === die ? equation.ri : equation.rj;
    assert(
      arm.length() <= DIE_BOUNDING_RADIUS + 0.001,
      "die anchor must not contain its world position",
    );
  }
  const budget = equations.reduce(
    (sum, equation) => sum + equation.maxForce,
    0,
  );
  assert(
    budget <= 2 * 0.33 * 9.81 * 0.019 + 1e-6,
    "two friction directions share one manifold budget",
  );
});
