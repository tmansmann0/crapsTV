import {
  Body,
  Box,
  ContactMaterial,
  Material,
  Plane,
  Vec3,
  World,
} from "cannon-es";
import { correctContactFriction } from "./dice-physics.js";

const STEP = 1 / 120;
const STRENGTH = 27;
const GRAVITY = 17;

export function createDiceSuspension(poses) {
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
      restitution: 0.4,
    }),
  );
  world.addContactMaterial(
    new ContactMaterial(resin, felt, {
      friction: 0.38,
      restitution: 0.23,
    }),
  );

  function boundary(x, y, z, pitch, yaw) {
    const body = new Body({ mass: 0, material: felt, shape: new Plane() });
    body.position.set(x, y, z);
    body.quaternion.setFromEuler(pitch, yaw, 0);
    world.addBody(body);
  }

  boundary(0, 0, 0, -Math.PI / 2, 0);
  boundary(-2.25, 0, 0, 0, Math.PI / 2);
  boundary(2.25, 0, 0, 0, -Math.PI / 2);
  boundary(0, 0, -1.37, 0, 0);
  boundary(0, 0, 1.52, 0, Math.PI);
  boundary(0, 2.32, 0, Math.PI / 2, 0);

  const dice = poses.map(([x, y, z, qx, qy, qz, qw]) => {
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
    target.set(x * 1.23, 1.93, 0.15 + y * 0.89);
    if (!pulling) {
      anchor.copy(target);
      dice.forEach((body) => body.wakeUp());
    }
    pulling = true;
  }

  function step(seconds) {
    remaining = Math.min(0.075, remaining + Math.max(0, seconds));
    while (remaining >= STEP) {
      if (pulling) {
        anchor.lerp(target, 0.24, anchor);
        dice.forEach((body, index) => {
          // Pull at a point on each body, so the force can rotate it as well
          // as lift it. Both bodies share a target and collide independently.
          body.quaternion.vmult(attachment[index], arm);
          body.position.vadd(arm, point);
          anchor.vsub(point, force);
          force.scale(STRENGTH, force);
          body.angularVelocity.cross(arm, pointVelocity);
          pointVelocity.vadd(body.velocity, pointVelocity);
          pointVelocity.scale(-2.2, pointVelocity);
          force.vadd(pointVelocity, force);
          const magnitude = force.length();
          if (magnitude > 45) force.scale(45 / magnitude, force);
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

  return {
    pullToward,
    letGo() {
      pulling = false;
    },
    step,
    sample,
  };
}
