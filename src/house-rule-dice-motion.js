import {
  Body,
  Box,
  ContactMaterial,
  Material,
  Plane,
  Quaternion,
  Vec3,
  World,
} from "cannon-es";
import { correctContactFriction, seededRandom } from "./dice-physics.js";
import { diceQuaternion, upperDieFace } from "./throw-motion.js";

export const CHANCE_DIE_FRAME_MS = 1000 / 60;
const STEP = 1 / 120;

function simulateHop(index, random, markings) {
  const side = index === 0 ? -1 : 1;
  const world = new World({ gravity: new Vec3(0, -21, 0), allowSleep: true });
  world.solver.iterations = 20;
  world.narrowphase.enableFrictionReduction = true;
  correctContactFriction(world);
  const felt = new Material("felt");
  const resin = new Material("resin");
  world.addContactMaterial(
    new ContactMaterial(resin, felt, { friction: 0.38, restitution: 0.29 }),
  );
  const floor = new Body({ mass: 0, shape: new Plane(), material: felt });
  floor.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
  world.addBody(floor);

  const die = new Body({
    mass: 1,
    material: resin,
    shape: new Box(new Vec3(0.5, 0.5, 0.5)),
    linearDamping: 0.45,
    angularDamping: 0.56,
    sleepSpeedLimit: 0.16,
    sleepTimeLimit: 0.16,
  });
  die.position.set(side * 0.84, 0.5, 0.14);
  die.quaternion.setFromEuler(0, side * 0.19, 0);
  die.velocity.set(
    side * (0.1 + random() * 0.26),
    4.28 + random() * 0.9,
    (random() - 0.5) * 0.42,
  );
  die.angularVelocity.set(
    (random() - 0.5) * 31,
    (random() - 0.5) * 5,
    -side * (3.8 + random() * 11),
  );
  world.addBody(die);

  let step = 0;
  const contacts = [];
  die.addEventListener("collide", ({ contact }) => {
    const ms = Math.round(step * STEP * 1000);
    const speed = Math.abs(contact.getImpactVelocityAlongNormal());
    if (speed > 0.8 && (contacts.length === 0 || ms - contacts.at(-1).ms > 64))
      contacts.push({ ms, speed: Math.round(speed * 100) / 100 });
  });

  const marked = new Quaternion();
  function pose() {
    die.quaternion.mult(markings, marked);
    return [...die.position.toArray(), ...marked.toArray()].map(
      (value) => Math.round(value * 100000) / 100000,
    );
  }

  const frames = [pose()];
  for (step = 1; step <= 300; step++) {
    world.step(STEP);
    if (step % 2 === 0) frames.push(pose());
    if (
      side * die.position.x < 0.72 ||
      Math.abs(die.position.x) > 1.66 ||
      die.position.z < -0.65 ||
      die.position.z > 0.65
    )
      return null;
    if (step % 2 === 0 && die.sleepState === Body.SLEEPING) {
      const face = upperDieFace(frames.at(-1).slice(3));
      if (face.alignment > 0.995 && Math.abs(die.position.y - 0.5) < 0.02)
        return { frames, contacts, face: face.value };
      return null;
    }
  }
  return null;
}

// These 24 rotations map a cube onto itself. Randomizing the pip orientation
// independently of the launch gives each top face the same four possibilities.
const ORIENTATIONS = 24;
export const CHANCE_HOP_BUCKET = Math.floor(0x100000000 / ORIENTATIONS ** 2);
export const CHANCE_HOP_LIMIT = CHANCE_HOP_BUCKET * ORIENTATIONS ** 2;
function createChanceDieHop(index, seed, orientation) {
  let random = seededRandom(seed);
  const markings = new Quaternion(
    ...diceQuaternion(
      1 + Math.floor(orientation / 4),
      (orientation % 4) * (Math.PI / 2),
    ),
  );
  for (let retry = 0; retry < 96; retry++) {
    // The backup launch stream keeps a rare run of out-of-frame bounces from
    // stalling a room. It uses the same simulated motion and pip orientation.
    if (retry === 64) random = seededRandom(0);
    const hop = simulateHop(index, random, markings);
    if (hop) return hop;
  }
  throw new Error("The chance die could not settle.");
}

export function createChanceDiceHops(draw) {
  const orientations = Math.floor(draw / CHANCE_HOP_BUCKET);
  const seed = draw % CHANCE_HOP_BUCKET;
  return [
    createChanceDieHop(0, seed, Math.floor(orientations / ORIENTATIONS)),
    createChanceDieHop(1, seed ^ 0x9251fb65, orientations % ORIENTATIONS),
  ];
}
