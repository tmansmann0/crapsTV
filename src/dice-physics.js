import {
  World,
  Body,
  Box,
  Plane,
  Vec3,
  Material,
  ContactMaterial,
} from "cannon-es";
// Rigid body simulation used by the authority to precompute a shared throw.
// Retained stepping API also supports isolated physics/asset checks.
export const DICE_SIZE = 0.22;
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
export function createDicePhysics() {
  const world = new World({ gravity: new Vec3(0, -9.81, 0) });
  world.allowSleep = true;
  world.solver.iterations = 20;
  const resin = new Material("resin"),
    felt = new Material("felt"),
    rubber = new Material("rubber");
  world.addContactMaterial(
    new ContactMaterial(resin, felt, { friction: 0.33, restitution: 0.36 }),
  );
  world.addContactMaterial(
    new ContactMaterial(resin, rubber, { friction: 0.16, restitution: 0.58 }),
  );
  world.addContactMaterial(
    new ContactMaterial(resin, resin, { friction: 0.2, restitution: 0.42 }),
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
    wallHits = 0;
  bodies.forEach((b) =>
    b.addEventListener("collide", (e) => {
      if (e.body.material === rubber) wallHits++;
    }),
  );
  function throwDice(seed = 1, gesture = { x: 0, power: 0.65 }) {
    elapsed = 0;
    wallHits = 0;
    running = true;
    const random = seededRandom(seed);
    const aim = Math.max(-1, Math.min(1, gesture.x || 0));
    const power = Math.max(0, Math.min(1, gesture.power ?? 0.65));
    bodies.forEach((b, i) => {
      b.wakeUp();
      b.position.set(
        aim * 0.55 + (i ? 0.19 : -0.19),
        0.23 + power * 0.16 + i * 0.03,
        1.9 - power * 0.15,
      );
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
    bodies.forEach((b) => {
      b.velocity.setZero();
      b.angularVelocity.setZero();
    });
  }
  return {
    world,
    bodies,
    throwDice,
    step,
    stop,
    get sleeping() {
      return bodies.every((body) => body.sleepState === Body.SLEEPING);
    },
    get elapsed() {
      return elapsed;
    },
    get wallHits() {
      return wallHits;
    },
  };
}
