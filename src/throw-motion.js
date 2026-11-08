import { createDicePhysics, DICE_SIZE, BOUNDS } from "./dice-physics.js";
import { diceLaunchPositions } from "./dice-launch.js";

export const THROW_DURATION = 2500;
export const PHYSICS_VERSION = 5;
export const DEFAULT_GESTURE = Object.freeze({ x: 0, power: 0.65 });
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const rounded = (value) => Math.round(value * 100000) / 100000;

/** Only the two finite control values cross the authority boundary. */
export function sanitizeGesture(value, fallback = DEFAULT_GESTURE) {
  if (value === undefined) return { x: fallback.x, power: fallback.power };
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid throw gesture.");
  const x = value.x === undefined ? fallback.x : value.x;
  const power = value.power === undefined ? fallback.power : value.power;
  if (
    typeof x !== "number" ||
    !Number.isFinite(x) ||
    typeof power !== "number" ||
    !Number.isFinite(power)
  )
    throw new Error("Aim and throw power must be finite numbers.");
  return { x: rounded(clamp(x, -1, 1)), power: rounded(clamp(power, 0, 1)) };
}

function multiplyQuaternion(a, b) {
  const [ax, ay, az, aw] = a,
    [bx, by, bz, bw] = b;
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

/** Quaternion consistent with the GLB's +Y1/-Y6/+Z2/-Z5/+X3/-X4 faces. */
export function diceQuaternion(value, yaw = 0) {
  const q = Math.SQRT1_2;
  const bases = {
    1: [0, 0, 0, 1],
    2: [-q, 0, 0, q],
    3: [0, 0, q, q],
    4: [0, 0, -q, q],
    5: [q, 0, 0, q],
    6: [1, 0, 0, 0],
  };
  if (!bases[value]) throw new Error("Invalid die value.");
  return multiplyQuaternion(
    [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)],
    bases[value],
  );
}

function slerp(a, b, t) {
  let target = b,
    dot = a.reduce((n, v, i) => n + v * b[i], 0);
  if (dot < 0) {
    target = b.map((v) => -v);
    dot = -dot;
  }
  if (dot > 0.9995) {
    const q = a.map((v, i) => v + (target[i] - v) * t);
    const len = Math.hypot(...q);
    return q.map((v) => v / len);
  }
  const angle = Math.acos(clamp(dot, -1, 1)),
    sine = Math.sin(angle);
  const wa = Math.sin((1 - t) * angle) / sine,
    wb = Math.sin(t * angle) / sine;
  return a.map((v, i) => wa * v + wb * target[i]);
}

export function aimDicePose(aim = DEFAULT_GESTURE, props) {
  const gesture = sanitizeGesture(aim);
  const positions = diceLaunchPositions(gesture, props);
  const direction = new Float64Array([gesture.x * 0.38, 0, -1]);
  const len = Math.hypot(...direction);
  return {
    dice: [0, 1].map((i) => ({
      position: positions[i],
      quaternion: diceQuaternion(i + 1, gesture.x * 0.2),
    })),
    direction: Array.from(direction, (v) => v / len),
    power: gesture.power,
  };
}

/** The visible upper face of the GLB, derived from its physical orientation. */
export function upperDieFace(quaternion) {
  const length = Math.hypot(...quaternion);
  if (!length || !Number.isFinite(length))
    throw new Error("Invalid die orientation.");
  const [x, y, z, w] = quaternion.map((value) => value / length);
  // World-Y component of each local axis after quaternion rotation.
  const axes = [
    2 * (x * y + w * z),
    1 - 2 * (x * x + z * z),
    2 * (y * z - w * x),
  ];
  const candidates = [
    { value: 1, alignment: axes[1] },
    { value: 6, alignment: -axes[1] },
    { value: 2, alignment: axes[2] },
    { value: 5, alignment: -axes[2] },
    { value: 3, alignment: axes[0] },
    { value: 4, alignment: -axes[0] },
  ];
  return candidates.reduce((best, face) =>
    face.alignment > best.alignment ? face : best,
  );
}

const physicalPose = (body) => ({
  position: [body.position.x, body.position.y, body.position.z],
  quaternion: [
    body.quaternion.x,
    body.quaternion.y,
    body.quaternion.z,
    body.quaternion.w,
  ],
});

/**
 * Simulate ONCE on the authority, until both bodies physically sleep on the
 * felt. Every serialized pose comes directly from Cannon: no target faces,
 * positional correction or post-landing rotation. The upper faces determine
 * the result, rather than a separately chosen result determining the pose.
 */
export function createThrowTimeline({
  id,
  playerId,
  shooterId = playerId,
  seed,
  gesture,
  startAt = Date.now(),
  duration = THROW_DURATION,
  puck = null,
  stacks = [],
}) {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff)
    throw new Error("Invalid throw seed.");
  if (!Number.isFinite(startAt) || !Number.isFinite(duration) || duration < 0)
    throw new Error("Invalid throw timing.");
  const controls = sanitizeGesture(gesture);
  const physics = createDicePhysics({ puck, stacks });
  physics.throwDice(seed, controls);
  const raw = [physics.bodies.map(physicalPose)];
  const rawPuck = physics.puckBody ? [physicalPose(physics.puckBody)] : null;
  let steps = 0;
  while (steps < 1440) {
    physics.step(1 / 120);
    steps++;
    if (steps % 2 === 0) {
      raw.push(physics.bodies.map(physicalPose));
      if (rawPuck) rawPuck.push(physicalPose(physics.puckBody));
      if (steps >= 120 && physics.sleeping) break;
    }
  }
  const last = raw.at(-1);
  const faces = last.map((pose) => upperDieFace(pose.quaternion));
  // Only a nearby physical support can authorize a die above floor height.
  // A tall wager elsewhere cannot make a floating/stacked die valid.
  function supportedHeight(pose) {
    let top = DICE_SIZE * 0.15;
    for (const stack of stacks) {
      if (
        Math.hypot(
          pose.position[0] - stack.position[0],
          pose.position[2] - stack.position[2],
        ) <=
        stack.radius + DICE_SIZE * 0.72
      )
        top = Math.max(top, stack.position[1] + stack.height / 2);
    }
    if (physics.puckBody) {
      const marker = physicalPose(physics.puckBody),
        [x, , z] = marker.quaternion;
      const vertical = Math.min(1, Math.abs(1 - 2 * (x * x + z * z)));
      if (
        Math.hypot(
          pose.position[0] - marker.position[0],
          pose.position[2] - marker.position[2],
        ) <=
        puck.radius + DICE_SIZE * 0.72
      )
        top = Math.max(
          top,
          marker.position[1] +
            (puck.height / 2) * vertical +
            puck.radius * Math.sqrt(1 - vertical * vertical),
        );
    }
    return top + DICE_SIZE * 0.6;
  }
  // Tilted, off-table or moving dice are invalid; never force a target face.
  if (
    !physics.sleeping ||
    last.some(
      (pose, i) =>
        faces[i].alignment < 0.995 ||
        pose.position[1] > supportedHeight(pose) ||
        pose.position[1] < DICE_SIZE * 0.4 ||
        Math.abs(pose.position[0]) > BOUNDS.x - DICE_SIZE * 0.45 ||
        Math.abs(pose.position[2]) > BOUNDS.z - DICE_SIZE * 0.45,
    )
  ) {
    const error = new Error(
      "Dice did not settle flat on the table. Throw again.",
    );
    error.code = "DICE_UNSETTLED";
    throw error;
  }
  const settleOffset = duration * 0.88;
  const frames = raw.map((poses, index) => [
    rounded((index / (raw.length - 1)) * settleOffset),
    ...poses.flatMap((pose) =>
      [...pose.position, ...pose.quaternion].map(rounded),
    ),
  ]);
  const puckFrames = rawPuck
    ? rawPuck.map((pose, index) => [
        frames[index][0],
        ...[...pose.position, ...pose.quaternion].map(rounded),
      ])
    : null;
  if (puckFrames) puckFrames.push([duration, ...puckFrames.at(-1).slice(1)]);
  const propContacts = physics.propContacts.map((contact) => ({
    ...contact,
    time: rounded((contact.simulationTime / (steps / 120)) * settleOffset),
    speed: rounded(contact.speed),
    normal: contact.normal.map(rounded),
    position: contact.position.map(rounded),
    velocity: contact.velocity.map(rounded),
  }));
  // Hold the unmodified, already sleeping bodies briefly before results show.
  frames.push([duration, ...frames.at(-1).slice(1)]);
  return {
    version: PHYSICS_VERSION,
    id,
    playerId,
    shooterId,
    seed,
    startAt,
    duration,
    dice: faces.map((face) => face.value),
    gesture: controls,
    frames,
    puckFrames,
    props: {
      puck: puck ? structuredClone(puck) : null,
      stacks: structuredClone(stacks),
    },
    propContacts,
    stackContacts: propContacts
      .filter((contact) => contact.kind === "stack")
      .map((contact) => ({ ...contact, stackId: contact.id })),
    propHits: physics.propHits,
    settledAt: startAt + settleOffset,
    physicsSteps: steps,
    simulationDuration: steps / 120,
    wallHits: physics.wallHits,
  };
}

/** Stateless seeking: equal timestamps always return equal poses at any FPS. */
export function sampleThrow(throwState, now = Date.now()) {
  if (
    !throwState ||
    !Array.isArray(throwState.frames) ||
    !throwState.frames.length
  )
    return null;
  const { frames, startAt, duration } = throwState;
  const elapsed = clamp(now - startAt, 0, duration);
  let low = 0,
    high = frames.length - 1;
  while (low + 1 < high) {
    const mid = (low + high) >>> 1;
    if (frames[mid][0] <= elapsed) low = mid;
    else high = mid;
  }
  if (elapsed >= duration) low = high = frames.length - 1;
  const first = frames[low],
    second = frames[high];
  const t =
    second[0] === first[0] ? 0 : (elapsed - first[0]) / (second[0] - first[0]);
  const dice = [0, 1].map((i) => {
    const base = 1 + i * 7;
    const position = first
      .slice(base, base + 3)
      .map((v, j) => v + (second[base + j] - v) * t);
    const quaternion = slerp(
      first.slice(base + 3, base + 7),
      second.slice(base + 3, base + 7),
      t,
    );
    return { position, quaternion };
  });
  let puck = null;
  if (throwState.puckFrames?.length === frames.length) {
    const a = throwState.puckFrames[low],
      b = throwState.puckFrames[high];
    puck = {
      position: a.slice(1, 4).map((v, index) => v + (b[index + 1] - v) * t),
      quaternion: slerp(a.slice(4, 8), b.slice(4, 8), t),
    };
  }
  return {
    dice,
    puck,
    progress: duration ? elapsed / duration : 1,
    done: now >= startAt + duration,
    wallHits: throwState.wallHits,
    propHits: throwState.propHits || 0,
  };
}
