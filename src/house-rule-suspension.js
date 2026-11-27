import {
  Body,
  Box,
  ContactMaterial,
  Material,
  Plane,
  Vec3,
  World,
} from "cannon-es";
import { correctContactFriction, seededRandom } from "./dice-physics.js";
import { diceQuaternion, upperDieFace } from "./throw-motion.js";

const STEP = 1 / 120;
const LIFT_SPRING = 50;
const PULL_SPRING = 24;
const PULL_RADIUS = 0.92;
export const CHANCE_DIE_FRAME_MS = 1000 / 60;
const GRAVITY = 17;

export function chanceDiceStart(seed) {
  const random = seededRandom(seed);
  return [-1, 1].map((side) => [
    side * 0.84,
    0.5,
    0.14,
    ...diceQuaternion(1 + Math.floor(random() * 6), side * 0.19),
  ]);
}

export function createDiceSuspension(poses, velocities) {
  const world = new World({
    gravity: new Vec3(0, -GRAVITY, 0),
    allowSleep: true,
  });
  world.solver.iterations = 20;
  world.narrowphase.enableFrictionReduction = true;
  correctContactFriction(world);

  const resin = new Material("dice");
  const felt = new Material("felt");
  world.addContactMaterial(
    new ContactMaterial(resin, resin, {
      friction: 0.23,
      restitution: 0.58,
    }),
  );
  world.addContactMaterial(
    new ContactMaterial(resin, felt, {
      friction: 0.38,
      restitution: 0.23,
    }),
  );

  const rail = new Material("rail");
  world.addContactMaterial(
    new ContactMaterial(resin, rail, { friction: 0, restitution: 0.82 }),
  );
  const surfaces = new Map();
  const planeNormal = new Vec3(0, 0, 1);
  function boundary(x, y, z, normal, surface = "rail") {
    const body = new Body({
      mass: 0,
      material: surface === "felt" ? felt : rail,
      shape: new Plane(),
    });
    body.position.set(x, y, z);
    body.quaternion.setFromVectors(planeNormal, normal.unit());
    world.addBody(body);
    surfaces.set(body, surface);
  }

  boundary(0, 0, 0, new Vec3(0, 1, 0), "felt");
  boundary(-2.33, 0, 0, new Vec3(1, 0, 0));
  boundary(2.33, 0, 0, new Vec3(-1, 0, 0));
  boundary(0, 0, -1.46, new Vec3(0, 0, 1));
  boundary(0, 0, 1.61, new Vec3(0, 0, -1), "glass");
  boundary(0, 2.32, 0, new Vec3(0, -1, 0));

  const dice = poses.map(([x, y, z, qx, qy, qz, qw], index) => {
    const body = new Body({
      mass: 1,
      material: resin,
      shape: new Box(new Vec3(0.496, 0.496, 0.496)),
      linearDamping: 0.33,
      angularDamping: 0.48,
      sleepSpeedLimit: 0.13,
      sleepTimeLimit: 0.22,
    });
    body.position.set(x, y, z);
    body.quaternion.set(qx, qy, qz, qw);
    body.quaternion.normalize();
    const velocity = velocities?.[index];
    if (velocity) {
      body.velocity.set(...velocity.slice(0, 3));
      body.angularVelocity.set(...velocity.slice(3));
    }
    world.addBody(body);
    return body;
  });

  const attachment = [new Vec3(0.16, 0.25, 0.12), new Vec3(-0.2, 0.2, -0.12)];
  const anchor = new Vec3();
  const target = new Vec3();
  const arm = new Vec3();
  const force = new Vec3();
  const point = new Vec3();
  const pointVelocity = new Vec3();
  let pulling = false;
  let remaining = 0;

  function pullToward(x, y) {
    target.set(x * 1.35, 1.83, 0.15 + y * 0.89);
    if (!pulling) {
      anchor.copy(target);
      dice.forEach((body) => body.wakeUp());
    }
    pulling = true;
  }

  function step(seconds) {
    remaining = Math.min(0.075, remaining + Math.max(0, seconds));
    while (remaining + 1e-9 >= STEP) {
      if (pulling) {
        anchor.lerp(target, 0.24, anchor);
        dice.forEach((body, index) => {
          // Within reach of the finger, stop pulling sideways and let contact
          // and inertia decide how the dice spread. Both share the same lift.
          body.quaternion.vmult(attachment[index], arm);
          body.position.vadd(arm, point);
          anchor.vsub(point, force);
          const distance = Math.hypot(force.x, force.z);
          const pull =
            distance > PULL_RADIUS
              ? PULL_SPRING * (1 - PULL_RADIUS / distance)
              : 0;
          body.angularVelocity.cross(arm, pointVelocity);
          pointVelocity.vadd(body.velocity, pointVelocity);
          force.set(
            force.x * pull - body.velocity.x * 0.35,
            Math.max(0, force.y * LIFT_SPRING - pointVelocity.y * 3.1),
            force.z * pull - body.velocity.z * 0.35,
          );
          const magnitude = force.length();
          if (magnitude > 58) force.scale(58 / magnitude, force);
          body.applyForce(force, arm);
        });
      }
      world.step(STEP);
      remaining -= STEP;
    }
    return pulling || dice.some((body) => body.sleepState !== Body.SLEEPING);
  }

  function sample() {
    return dice.map((body) =>
      [...body.position.toArray(), ...body.quaternion.toArray()].map(
        (n) => Math.round(n * 10000) / 10000,
      ),
    );
  }

  function recordContacts(contacts, time) {
    dice.forEach((body, index) => {
      body.addEventListener("collide", ({ body: other, contact }) => {
        const ms = time();
        const surface = surfaces.get(other) ?? "dice";
        if (surface === "dice" && index === 1) return;
        const speed = Math.abs(contact.getImpactVelocityAlongNormal());
        if (speed < 0.85 || (surface === "glass" && speed < 1.7)) return;
        if (
          contacts[index].some(
            (entry) => entry.surface === surface && ms - entry.ms < 55,
          )
        )
          return;
        contacts[index].push({
          ms,
          speed: Math.round(speed * 100) / 100,
          surface,
        });
      });
    });
  }

  return {
    pullToward,
    letGo() {
      pulling = false;
    },
    step,
    sample,
    velocities() {
      return dice.map((body) => [
        ...body.velocity.toArray(),
        ...body.angularVelocity.toArray(),
      ]);
    },
    recordContacts,
  };
}

export function chanceDiceLaunchVelocities(seed) {
  const random = seededRandom(seed);
  return [-1, 1].map((side) => [
    side * (0.2 + random() * 0.7),
    3.4 + random() * 1.15,
    (random() - 0.25) * 1.7,
    (random() - 0.5) * 29,
    (random() - 0.5) * 7,
    -side * (4 + random() * 9),
  ]);
}

export function simulateChanceDrop(poses, velocities, flick = 0) {
  const released = velocities.map(([vx, vy, vz, wx, wy, wz]) => [
    vx,
    vy,
    vz + 8.5 * flick,
    wx,
    wy,
    wz,
  ]);
  const physics = createDiceSuspension(poses, released);
  const contacts = [[], []];
  const hops = poses.map((pose, index) => ({
    frames: [pose],
    contacts: contacts[index],
  }));
  let frame = 0;
  physics.recordContacts(contacts, () => frame * CHANCE_DIE_FRAME_MS);

  for (frame = 1; frame <= 210; frame++) {
    const moving = physics.step(1 / 60);
    const samples = physics.sample();
    hops.forEach(({ frames }, index) => frames.push(samples[index]));
    if (!moving) {
      const tops = samples.map((pose) => upperDieFace(pose.slice(3)));
      const dice = tops.every(({ alignment }) => alignment > 0.995)
        ? tops.map(({ value }) => value)
        : null;
      return { hops, dice };
    }
  }
  return { hops, dice: null };
}
