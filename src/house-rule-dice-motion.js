import { Quaternion, Vector3 } from "three";
import {
  HOUSE_RULE_DIE_CONTACTS,
  HOUSE_RULE_DIE_FLIGHT_MS,
  HOUSE_RULE_DIE_LANDING_MS,
} from "./house-rules.js";
import { diceQuaternion } from "./throw-motion.js";

const flightSeconds = HOUSE_RULE_DIE_FLIGHT_MS / 1000;
const landingSeconds = HOUSE_RULE_DIE_LANDING_MS / 1000;
const bounceEnds = [0, ...HOUSE_RULE_DIE_CONTACTS, 1];
const bounceHeights = [0.56, 0.14, 0.035];
const easeOut = (t) => 1 - (1 - t) ** 2;
const smoothstep = (t) => t * t * (3 - 2 * t);

function bounceHeight(progress) {
  const bounce =
    progress < bounceEnds[1] ? 0 : progress < bounceEnds[2] ? 1 : 2;
  const local =
    (progress - bounceEnds[bounce]) /
    (bounceEnds[bounce + 1] - bounceEnds[bounce]);
  return 4 * bounceHeights[bounce] * local * (1 - local);
}

/** One finite toss from rest, followed by a short settle onto the authority's face. */
export function createChanceDieMotion(index) {
  const side = index === 0 ? -1 : 1;
  const yaw = side * 0.17;
  const startX = side * 1.38;
  const startZ = -0.66;
  const dx = side * -0.35;
  const dz = 1.08;
  const position = new Vector3(startX, 0.5, startZ);
  const restRotation = new Quaternion().fromArray(diceQuaternion(1, yaw));
  const orientation = restRotation.clone();
  const tossAxis = new Vector3(dz, side * 0.18, -dx).normalize();
  const landingRotation = new Quaternion();
  const finalRotation = new Quaternion();
  const candidate = new Quaternion();
  let mode = "rest";
  let age = 0;
  let landingFace;

  function groundedHeight() {
    // A rotated cube sits on its lowest edge until a full face reaches the felt.
    const { x, y, z, w } = orientation;
    const extent =
      (Math.abs(2 * (x * y + w * z)) +
        Math.abs(1 - 2 * (x * x + z * z)) +
        Math.abs(2 * (y * z - w * x))) /
      2;
    return 0.5 + (extent - 0.5) * 0.92;
  }

  function sampleToss(progress) {
    const travel = easeOut(progress);
    const turns = (index === 0 ? 1.18 : 1.32) * (1 - (1 - progress) ** 1.5);
    orientation
      .setFromAxisAngle(tossAxis, turns * Math.PI * 2)
      .multiply(restRotation);
    position.set(
      startX + dx * travel,
      groundedHeight() + bounceHeight(progress),
      startZ + dz * travel,
    );
  }

  function prepareLanding(face) {
    landingFace = face;
    sampleToss(1);
    landingRotation.copy(orientation);
    finalRotation.fromArray(diceQuaternion(face, yaw));
    // Keep the server's top face while choosing the nearest resting yaw.
    for (const offset of [-Math.PI / 2, Math.PI / 2, Math.PI]) {
      candidate.fromArray(diceQuaternion(face, yaw + offset));
      if (
        Math.abs(landingRotation.dot(candidate)) >
        Math.abs(landingRotation.dot(finalRotation))
      )
        finalRotation.copy(candidate);
    }
  }

  function sampleLanding(progress) {
    orientation.slerpQuaternions(
      landingRotation,
      finalRotation,
      smoothstep(progress),
    );
    position.set(
      startX + dx,
      groundedHeight(),
      startZ + dz + 0.075 * smoothstep(progress),
    );
  }

  function sync({ throwing, face, value, reduceMotion = false }) {
    if (value != null) {
      if (mode === "settled" && landingFace === value) return;
      if (landingFace !== value) prepareLanding(value);
      sampleLanding(1);
      mode = "settled";
    } else if (!reduceMotion && face != null && mode !== "landing") {
      prepareLanding(face);
      mode = "landing";
      age = 0;
    } else if (!reduceMotion && throwing && mode === "rest") {
      mode = "throwing";
      age = 0;
    }
  }

  function advance(seconds) {
    age += seconds;
    if (mode === "throwing") {
      const progress = Math.min(1, age / flightSeconds);
      sampleToss(progress);
      return progress < 1;
    }
    if (mode === "landing") {
      const progress = Math.min(1, age / landingSeconds);
      sampleLanding(progress);
      return progress < 1;
    }
    return false;
  }

  return { position, orientation, sync, advance };
}
