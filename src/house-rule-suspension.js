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
import {
  CHANCE_PHONE_HALF_WIDTH,
  SUSPENSION_MAX_SPEED,
  SUSPENSION_MAX_SPIN,
} from "./house-rule-fling.js";

const STEP = 1 / 120;
const LIFT_SPRING = 96;
const TETHER_SPRING = 78;
const TETHER_LENGTHS = [0.93, 1.04];
const PICKUP_SPIN = [new Vec3(-11, 17, -10), new Vec3(12, -16, 9)];
const SPIN_INPUT_DECAY = Math.exp(-STEP / 0.11);
export const CHANCE_DIE_FRAME_MS = 1000 / 60;
const GRAVITY = 17;
const SIDE_RAIL = 2.33;
const BACK_RAIL = -1.46;
const FRONT_RAIL = 1.61;
const DRAG_FOLLOW = 0.95;
const MAX_RAIL_SLIP = 0.65;

function capSpeed(vector, limit) {
  const speed = vector.length();
  if (speed > limit) vector.scale((limit - 0.001) / speed, vector);
}

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
  boundary(-SIDE_RAIL, 0, 0, new Vec3(1, 0, 0));
  boundary(SIDE_RAIL, 0, 0, new Vec3(-1, 0, 0));
  boundary(0, 0, BACK_RAIL, new Vec3(0, 0, 1));
  boundary(0, 0, FRONT_RAIL, new Vec3(0, 0, -1), "glass");
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
    body.aabbNeedsUpdate = true;
    const velocity = velocities?.[index];
    if (velocity) {
      body.velocity.set(...velocity.slice(0, 3));
      body.angularVelocity.set(...velocity.slice(3));
    }
    world.addBody(body);
    return body;
  });

  const attachment = [new Vec3(0.16, 0.25, 0.12), new Vec3(-0.2, 0.2, -0.12)];
  const target = new Vec3();
  const handVelocities = dice.map(() => new Vec3());
  const lastDirection = new Vec3();
  const spinDrive = new Vec3();
  const moves = dice.map(() => new Vec3());
  const railSlip = dice.map(() => new Vec3());
  const shared = new Vec3();
  const candidate = dice.map(() => new Vec3());
  const axis = new Vec3();
  const arm = new Vec3();
  const force = new Vec3();
  const point = new Vec3();
  const pointVelocity = new Vec3();
  let pulling = false;
  let remaining = 0;
  let sinceDrag = Infinity;

  function boxesOverlap(fraction) {
    const [a, b] = dice;
    for (let i = 0; i < dice.length; i++) {
      railSlip[i].scale(fraction, candidate[i]);
      candidate[i].vadd(dice[i].position, candidate[i]);
    }
    return a.shapes[0].convexPolyhedronRepresentation.findSeparatingAxis(
      b.shapes[0].convexPolyhedronRepresentation,
      candidate[0],
      a.quaternion,
      candidate[1],
      b.quaternion,
      axis,
    );
  }

  function carryWithHand(dx, dz, seconds) {
    // Follow the pointer delta now. At a rail, the free die can still move
    // as long as its hull has clearance from the die that hit the rail.
    shared.set(dx, 0, dz);
    for (let i = 0; i < dice.length; i++) {
      const body = dice[i];
      if (body.aabbNeedsUpdate) body.updateAABB();
      const { lowerBound, upperBound } = body.aabb;
      moves[i].set(
        Math.max(
          Math.min(0, -SIDE_RAIL - lowerBound.x),
          Math.min(Math.max(0, SIDE_RAIL - upperBound.x), dx),
        ),
        0,
        Math.max(
          Math.min(0, BACK_RAIL - lowerBound.z),
          Math.min(Math.max(0, FRONT_RAIL - upperBound.z), dz),
        ),
      );
      if (Math.abs(moves[i].x) < Math.abs(shared.x)) shared.x = moves[i].x;
      if (Math.abs(moves[i].z) < Math.abs(shared.z)) shared.z = moves[i].z;
    }
    let slip = 1;
    if (dice.length === 2 && moves.some((move) => !move.almostEquals(shared))) {
      for (let i = 0; i < dice.length; i++) {
        moves[i].vsub(shared, railSlip[i]);
        capSpeed(railSlip[i], MAX_RAIL_SLIP);
      }
      if (boxesOverlap(0)) slip = 0;
      else if (boxesOverlap(1)) {
        let blocked = 1;
        slip = 0;
        for (let i = 0; i < 5; i++) {
          const fraction = (slip + blocked) / 2;
          if (boxesOverlap(fraction)) blocked = fraction;
          else slip = fraction;
        }
      }
      for (let i = 0; i < dice.length; i++) {
        railSlip[i].scale(slip, moves[i]);
        moves[i].vadd(shared, moves[i]);
      }
    }
    for (let i = 0; i < dice.length; i++) {
      const body = dice[i];
      body.position.vadd(moves[i], body.position);
      body.aabbNeedsUpdate = true;
      moves[i].scale(1 / seconds, handVelocities[i]);
      capSpeed(handVelocities[i], SUSPENSION_MAX_SPEED);
    }
  }

  function steerSpin(dx, dz, seconds) {
    const travel = Math.hypot(dx, dz);
    const x = dx / travel;
    const z = dz / travel;
    // A curved swipe winds up the yaw. A straight swipe still tumbles the
    // dice along its direction. Use raw input so a rail can't kill the spin.
    const speed = travel / seconds;
    const grip = Math.max(0, Math.min(1, (speed - 0.45) / 1.5));
    const turn =
      sinceDrag < 0.12 ? (lastDirection.z * x - lastDirection.x * z) * grip : 0;
    spinDrive.set(
      (3.8 * dz) / seconds,
      (3.2 * turn) / seconds,
      (-3.8 * dx) / seconds,
    );
    capSpeed(spinDrive, 38);
    lastDirection.set(x, 0, z);
    sinceDrag = 0;
  }

  function pullToward(x, y, seconds = STEP) {
    const nextX = x * CHANCE_PHONE_HALF_WIDTH;
    const nextZ = 0.15 + y * 1.65;
    if (pulling) {
      const dx = (nextX - target.x) * DRAG_FOLLOW;
      const dz = (nextZ - target.z) * DRAG_FOLLOW;
      if (dx || dz) {
        const interval = Math.max(STEP, seconds);
        carryWithHand(dx, dz, interval);
        steerSpin(dx, dz, interval);
      }
    } else {
      dice.forEach((body, index) => {
        body.wakeUp();
        body.velocity.y += 1.95;
        body.angularVelocity.vadd(PICKUP_SPIN[index], body.angularVelocity);
      });
    }
    target.set(nextX, 1.81, nextZ);
    pulling = true;
  }

  function step(seconds) {
    remaining = Math.min(0.075, remaining + Math.max(0, seconds));
    while (remaining + 1e-9 >= STEP) {
      if (pulling) {
        const angularDrag = 0.32 + 1.08 * Math.min(1, spinDrive.length() / 20);
        dice.forEach((body, index) => {
          // A slack tether only pulls when stretched. Between tugs each die
          // is free to coast, overshoot the finger and hit the other die.
          body.quaternion.vmult(attachment[index], arm);
          body.position.vadd(arm, point);
          target.vsub(point, force);
          const distance = Math.hypot(force.x, force.z);
          const stretch = distance - TETHER_LENGTHS[index];
          body.angularVelocity.cross(arm, pointVelocity);
          pointVelocity.vadd(body.velocity, pointVelocity);

          let pull = 0;
          if (stretch > 0) {
            const closingSpeed =
              (force.x * pointVelocity.x + force.z * pointVelocity.z) /
              distance;
            const tension =
              stretch * (TETHER_SPRING + 24 * stretch) - 1.7 * closingSpeed;
            pull = Math.max(0, Math.min(120, tension)) / distance;
          }
          const handVelocity = handVelocities[index];
          force.set(
            force.x * pull - body.velocity.x * 0.42 - handVelocity.x * 1.1,
            Math.max(
              0,
              Math.min(110, force.y * LIFT_SPRING - pointVelocity.y * 5.6),
            ),
            force.z * pull - body.velocity.z * 0.42 - handVelocity.z * 1.1,
          );
          body.applyForce(force, arm);
          const coupling = index === 0 ? 1.95 : 1.65;
          body.torque.x +=
            spinDrive.x * coupling - angularDrag * body.angularVelocity.x;
          body.torque.y +=
            spinDrive.y * (2 - 0.18 * index) -
            angularDrag * body.angularVelocity.y;
          body.torque.z +=
            spinDrive.z * coupling - angularDrag * body.angularVelocity.z;
        });
      }
      world.step(STEP);
      if (pulling) {
        spinDrive.scale(SPIN_INPUT_DECAY, spinDrive);
        sinceDrag += STEP;
        // Bound the energy from extreme finger motion to the same limits the
        // authority accepts, so a fast flick can carry its actual momentum.
        dice.forEach((body, index) => {
          const handVelocity = handVelocities[index];
          handVelocity.scale(Math.exp(-STEP / 0.065), handVelocity);
          capSpeed(body.velocity, SUSPENSION_MAX_SPEED);
          capSpeed(body.angularVelocity, SUSPENSION_MAX_SPIN);
        });
      }
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
      if (!pulling) return;
      pulling = false;
      sinceDrag = Infinity;
      spinDrive.setZero();
      dice.forEach((body, index) => {
        const handVelocity = handVelocities[index];
        handVelocity.scale(0.75, handVelocity);
        body.velocity.vadd(handVelocity, body.velocity);
        capSpeed(body.velocity, SUSPENSION_MAX_SPEED);
        capSpeed(body.angularVelocity, SUSPENSION_MAX_SPIN);
        handVelocity.setZero();
      });
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
