import { Quaternion, Vector3 } from "three";
import { diceQuaternion } from "./throw-motion.js";

const CHANCE_DIE_SETTLE_SECONDS = 0.38;

const clamp01 = (value) => Math.max(0, Math.min(1, value));
const smoothstep = (value) => value * value * (3 - 2 * value);

/** Each die rolls in its own lane. Only the server supplies a landed face. */
export function createChanceDieMotion(index) {
  const side = index === 0 ? -1 : 1;
  const yaw = side * 0.17;
  const homeX = side * 1.12;
  const homeZ = 0.18;
  const position = new Vector3(homeX, 0.5, homeZ);
  const orientation = new Quaternion().fromArray(diceQuaternion(1, yaw));
  const axis = new Vector3();
  const rotation = new Quaternion();
  const drift = new Vector3();
  const landingStart = new Vector3();
  const landingRotation = new Quaternion();
  const finalRotation = new Quaternion();
  const candidate = new Quaternion();
  let mode = "parked";
  let age = 0;
  let launchX = 0;
  let launchZ = 0;
  let bounce = 0;
  let velocityX = 0;
  let velocityZ = 0;

  function rollForward(dx, dz) {
    const distance = Math.hypot(dx, dz);
    if (distance < 1e-6) return;
    axis.set(dz / distance, 0, -dx / distance);
    rotation.setFromAxisAngle(axis, distance * 2);
    orientation.premultiply(rotation).normalize();
  }

  function groundedHeight() {
    // The extent of a rotated unit cube along world Y keeps the edges
    // on the felt as it rolls. The model's bevel slightly rounds the contact.
    const { x, y, z, w } = orientation;
    const extent =
      (Math.abs(2 * (x * y + w * z)) +
        Math.abs(1 - 2 * (x * x + z * z)) +
        Math.abs(2 * (y * z - w * x))) /
      2;
    return 0.5 + (extent - 0.5) * 0.92;
  }

  function sync({ rolling, value, enter = false, reduceMotion = false }) {
    if (value != null && (mode === "rolling" || mode === "parked")) {
      finalRotation.fromArray(diceQuaternion(value, yaw));
      if (mode === "parked" || reduceMotion) {
        orientation.copy(finalRotation);
        position.y = 0.5;
        mode = "settled";
        return;
      }
      landingStart.copy(position);
      landingRotation.copy(orientation);
      // The top face is fixed, but the die can finish on any of its four edges.
      // Pick the nearest yaw to avoid an unnecessary spin to a canonical pose.
      for (const offset of [-Math.PI / 2, Math.PI / 2, Math.PI]) {
        candidate.fromArray(diceQuaternion(value, yaw + offset));
        if (
          Math.abs(orientation.dot(candidate)) >
          Math.abs(orientation.dot(finalRotation))
        )
          finalRotation.copy(candidate);
      }
      drift.set(velocityX, 0, velocityZ).multiplyScalar(0.116);
      drift.clampLength(0, 0.24);
      const endX = Math.abs(position.x + drift.x);
      if (endX < 0.72) drift.x = side * 0.72 - position.x;
      age = 0;
      mode = "settling";
    } else if (rolling && mode === "parked" && !reduceMotion) {
      launchX = enter ? side * 1.03 : 0;
      launchZ = enter ? -0.52 : 0.34;
      position.set(homeX + launchX, 0.5, -0.16 + launchZ);
      bounce = enter ? 0.15 : 0.055;
      age = 0;
      mode = "rolling";
    }
  }

  function advance(seconds) {
    // Cap free rolling after a long frame while keeping the reveal on time.
    if (mode === "rolling") seconds = Math.min(seconds, 0.04);
    age += seconds;
    if (mode === "rolling") {
      const turn = age * (index === 0 ? 4.6 : 4.9);
      const entry = clamp01(age / 0.57);
      const x =
        homeX - side * 0.4 * Math.sin(turn) + launchX * (1 - smoothstep(entry));
      const z =
        0.18 - 0.34 * Math.cos(turn) + launchZ * (1 - smoothstep(entry));
      const dx = x - position.x;
      const dz = z - position.z;
      if (seconds > 0) {
        velocityX = dx / seconds;
        velocityZ = dz / seconds;
        rollForward(dx, dz);
      }
      const hop = bounce * Math.sin(Math.PI * entry) * (1 - entry);
      position.set(x, groundedHeight() + hop, z);
    } else if (mode === "settling") {
      const t = clamp01(age / CHANCE_DIE_SETTLE_SECONDS);
      const coast = 1 - (1 - t) ** 3;
      orientation.slerpQuaternions(
        landingRotation,
        finalRotation,
        smoothstep(t),
      );
      const momentum = 2.44 * t * (1 - t) ** 3;
      rollForward(drift.x * momentum, drift.z * momentum);
      position.set(
        landingStart.x + drift.x * coast,
        groundedHeight(),
        landingStart.z + drift.z * coast,
      );
      if (t === 1) mode = "settled";
    }
    return mode === "rolling" || mode === "settling";
  }

  return { position, orientation, sync, advance };
}
