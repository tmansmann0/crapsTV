import {
  World,
  Body,
  Box,
  Cylinder,
  SAPBroadphase,
  Plane,
  Vec3,
  Material,
  ContactMaterial,
} from "cannon-es";
import { DICE_SIZE, diceLaunchPositions } from "./dice-launch.js";
export { DICE_SIZE } from "./dice-launch.js";
// Rigid body simulation used by the authority to precompute a shared throw.
// Retained stepping API also supports isolated physics/asset checks.
export const BOUNDS = { x: 5.42, z: 2.71, height: 0.92, cornerRadius: 0.86 };
/** Full 32-bit seeded launch randomness. No face outcome is selected here. */
export function seededRandom(seed) {
  let value = seed >>> 0;
  return () => {
    value = (value + 0x6d2b79f5) >>> 0;
    let mixed = Math.imul(value ^ (value >>> 15), value | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}
export const MAX_WAGER_COLLIDERS = 1024;
function correctContactFriction(world) {
  // cannon-es 0.20's averaged-friction path swaps body-local contact arms.
  // Use each original contact instead, sharing the manifold's Coulomb force
  // budget across its points. This keeps the correct lever arms and resists
  // flat-face spinning without multiplying a many-sided puck's friction.
  world.narrowphase.createFrictionFromAverage = function (count) {
    for (let i = 0; i < count; i++) {
      const contact = this.result[this.result.length - 1 - i];
      if (
        !this.createFrictionEquationsFromContact(contact, this.frictionResult)
      )
        continue;
      for (const equation of this.frictionResult.slice(-2)) {
        equation.minForce /= count;
        equation.maxForce /= count;
      }
    }
  };
}
export function createDicePhysics({ puck = null, stacks = [] } = {}) {
  const world = new World({ gravity: new Vec3(0, -9.81, 0) });
  world.allowSleep = true;
  world.broadphase = new SAPBroadphase(world);
  world.solver.iterations = 20;
  // Route each manifold through the corrected, distributed force budget;
  // do not use Cannon's position-dependent averaged anchors.
  world.narrowphase.enableFrictionReduction = true;
  correctContactFriction(world);
  const resin = new Material("resin"),
    felt = new Material("felt"),
    rubber = new Material("rubber"),
    marker = new Material("puck"),
    clay = new Material("wager-stacks");
  world.addContactMaterial(
    new ContactMaterial(resin, felt, { friction: 0.33, restitution: 0.36 }),
  );
  world.addContactMaterial(
    new ContactMaterial(resin, rubber, { friction: 0.16, restitution: 0.58 }),
  );
  world.addContactMaterial(
    new ContactMaterial(resin, resin, { friction: 0.2, restitution: 0.42 }),
  );
  world.addContactMaterial(
    new ContactMaterial(resin, marker, { friction: 0.34, restitution: 0.22 }),
  );
  world.addContactMaterial(
    new ContactMaterial(marker, felt, { friction: 0.03, restitution: 0.04 }),
  );
  world.addContactMaterial(
    new ContactMaterial(marker, rubber, { friction: 0.4, restitution: 0.14 }),
  );
  world.addContactMaterial(
    new ContactMaterial(resin, clay, { friction: 0.32, restitution: 0.2 }),
  );
  world.addContactMaterial(
    new ContactMaterial(marker, clay, { friction: 0.5, restitution: 0.06 }),
  );
  const floor = new Body({ mass: 0, material: felt, shape: new Plane() });
  floor.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
  world.addBody(floor);
  function wall(x, z, hx, hz, angle = 0) {
    const b = new Body({
      mass: 0,
      material: rubber,
      shape: new Box(new Vec3(hx, BOUNDS.height / 2, hz)),
    });
    b.position.set(x, BOUNDS.height / 2, z);
    b.quaternion.setFromEuler(0, angle, 0);
    world.addBody(b);
  }
  wall(BOUNDS.x + 0.1, 0, 0.1, BOUNDS.z - BOUNDS.cornerRadius);
  wall(-BOUNDS.x - 0.1, 0, 0.1, BOUNDS.z - BOUNDS.cornerRadius);
  wall(0, BOUNDS.z + 0.1, BOUNDS.x - BOUNDS.cornerRadius, 0.1);
  wall(0, -BOUNDS.z - 0.1, BOUNDS.x - BOUNDS.cornerRadius, 0.1);
  // Short tangent segments follow the inner rounded rubber corners.
  for (const sx of [-1, 1])
    for (const sz of [-1, 1])
      for (let i = 0; i < 8; i++) {
        const a = ((i + 0.5) * Math.PI) / 16,
          r = BOUNDS.cornerRadius + 0.07;
        const x = sx * (BOUNDS.x - BOUNDS.cornerRadius + r * Math.cos(a));
        const z = sz * (BOUNDS.z - BOUNDS.cornerRadius + r * Math.sin(a));
        const tangent = Math.atan2(-sx * Math.sin(a), sz * Math.cos(a));
        wall(x, z, 0.105, 0.075, tangent);
      }
  const validPosition = (value) =>
    Array.isArray(value) && value.length === 3 && value.every(Number.isFinite);
  function validCylinder(prop) {
    return (
      prop &&
      validPosition(prop.position) &&
      Math.abs(prop.position[0]) < BOUNDS.x + 0.3 &&
      Math.abs(prop.position[2]) < BOUNDS.z + 0.3 &&
      prop.position[1] >= 0 &&
      prop.position[1] <= 0.7 &&
      Number.isFinite(prop.radius) &&
      prop.radius > 0 &&
      prop.radius <= 0.4 &&
      Number.isFinite(prop.height) &&
      prop.height > 0 &&
      prop.height <= 0.6
    );
  }
  if (
    !Array.isArray(stacks) ||
    stacks.length > MAX_WAGER_COLLIDERS ||
    stacks.some((prop) => !validCylinder(prop))
  )
    throw new Error("Invalid wager colliders.");
  if (
    puck &&
    (!validCylinder(puck) ||
      !Array.isArray(puck.quaternion) ||
      puck.quaternion.length !== 4 ||
      !puck.quaternion.every(Number.isFinite) ||
      Math.hypot(...puck.quaternion) < 0.9)
  )
    throw new Error("Invalid puck collider.");
  const stackBodies = stacks.map((prop) => {
    const body = new Body({
      mass: 0,
      material: clay,
      shape: new Cylinder(prop.radius, prop.radius, prop.height, 12),
    });
    body.position.set(...prop.position);
    body.propId = prop.id;
    world.addBody(body);
    return body;
  });
  const puckBody = puck
    ? new Body({
        mass: 0.18,
        material: marker,
        shape: new Cylinder(puck.radius, puck.radius, puck.height, 24),
        linearDamping: 0.4,
        angularDamping: 0.5,
        sleepSpeedLimit: 0.035,
        sleepTimeLimit: 0.25,
      })
    : null;
  if (puckBody) {
    puckBody.position.set(...puck.position);
    puckBody.quaternion.set(...puck.quaternion);
    puckBody.quaternion.normalize();
    world.addBody(puckBody);
  }
  const bodies = [0, 1].map(() => {
    const b = new Body({
      mass: 0.019,
      material: resin,
      shape: new Box(new Vec3(DICE_SIZE / 2, DICE_SIZE / 2, DICE_SIZE / 2)),
      linearDamping: 0.25,
      angularDamping: 0.32,
      sleepSpeedLimit: 0.045,
      sleepTimeLimit: 0.22,
    });
    world.addBody(b);
    return b;
  });
  let running = false,
    elapsed = 0,
    wallHits = 0,
    propHits = 0;
  const propContacts = [];
  const contactKeys = new Set();
  bodies.forEach((b, die) =>
    b.addEventListener("collide", (e) => {
      if (e.body.material === rubber) wallHits++;
      if (e.body.material === marker || e.body.material === clay) {
        propHits++;
        const contactKey = `${e.body.propId || "puck"}:${die}:${elapsed}`;
        if (propContacts.length < 128 && !contactKeys.has(contactKey)) {
          contactKeys.add(contactKey);
          const contact = e.contact;
          const side = contact.bi === b ? -1 : 1;
          const arm = contact.bi === b ? contact.ri : contact.rj;
          propContacts.push({
            id: e.body.propId || "puck",
            kind: e.body.material === marker ? "puck" : "stack",
            die,
            simulationTime: elapsed,
            speed: Math.abs(contact.getImpactVelocityAlongNormal()),
            normal: [
              contact.ni.x * side,
              contact.ni.y * side,
              contact.ni.z * side,
            ],
            position: [
              b.position.x + arm.x,
              b.position.y + arm.y,
              b.position.z + arm.z,
            ],
            velocity: [b.velocity.x, b.velocity.y, b.velocity.z],
          });
        }
      }
    }),
  );
  function throwDice(seed = 1, gesture = { x: 0, power: 0.65 }) {
    elapsed = 0;
    wallHits = 0;
    propHits = 0;
    propContacts.length = 0;
    contactKeys.clear();
    running = true;
    if (puckBody) {
      puckBody.wakeUp();
      puckBody.position.set(...puck.position);
      puckBody.quaternion.set(...puck.quaternion);
      puckBody.quaternion.normalize();
      puckBody.velocity.setZero();
      puckBody.angularVelocity.setZero();
      puckBody.force.setZero();
      puckBody.torque.setZero();
    }
    const random = seededRandom(seed);
    const aim = Math.max(-1, Math.min(1, gesture.x || 0));
    const power = Math.max(0, Math.min(1, gesture.power ?? 0.65));
    const positions = diceLaunchPositions({ x: aim, power }, { puck, stacks });
    bodies.forEach((b, i) => {
      b.wakeUp();
      b.position.set(...positions[i]);
      // Uniform random orientation on the unit quaternion sphere.
      const u = random(),
        a = random() * Math.PI * 2,
        c = random() * Math.PI * 2;
      b.quaternion.set(
        Math.sqrt(1 - u) * Math.sin(a),
        Math.sqrt(1 - u) * Math.cos(a),
        Math.sqrt(u) * Math.sin(c),
        Math.sqrt(u) * Math.cos(c),
      );
      b.velocity.set(
        aim * 3.4 + (random() - 0.5) * 0.9,
        1.7 + power * 1.1 + random() * 0.3,
        -7.8 - power * 2.5 + (random() - 0.5) * 0.8,
      );
      b.angularVelocity.set(
        (random() - 0.5) * 32,
        (random() - 0.5) * 32,
        (random() - 0.5) * 32,
      );
      b.force.setZero();
      b.torque.setZero();
    });
  }
  function step(dt) {
    if (!running) return;
    world.step(1 / 120, Math.min(dt, 0.5), 60);
    elapsed += dt;
    if (elapsed > 12) running = false;
  }
  function stop() {
    running = false;
    [...bodies, ...(puckBody ? [puckBody] : [])].forEach((b) => {
      b.velocity.setZero();
      b.angularVelocity.setZero();
    });
  }
  return {
    world,
    bodies,
    puckBody,
    stackBodies,
    throwDice,
    step,
    stop,
    get sleeping() {
      return [...bodies, ...(puckBody ? [puckBody] : [])].every(
        (body) => body.sleepState === Body.SLEEPING,
      );
    },
    get elapsed() {
      return elapsed;
    },
    get wallHits() {
      return wallHits;
    },
    get propHits() {
      return propHits;
    },
    get propContacts() {
      return propContacts;
    },
  };
}
