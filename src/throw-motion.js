import { createDicePhysics, DICE_SIZE, BOUNDS } from "./dice-physics.js";

export const THROW_DURATION = 2500;
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

export function aimDicePose(aim = DEFAULT_GESTURE) {
  const gesture = sanitizeGesture(aim);
  const direction = new Float64Array([gesture.x * 0.38, 0, -1]);
  const len = Math.hypot(...direction);
  return {
    dice: [0, 1].map((i) => ({
      position: [
        gesture.x * 0.55 + (i ? 0.17 : -0.17),
        DICE_SIZE / 2 + 0.04 + gesture.power * 0.18,
        1.9 - gesture.power * 0.15,
      ],
      quaternion: diceQuaternion(i + 1, gesture.x * 0.2),
    })),
    direction: Array.from(direction, (v) => v / len),
    power: gesture.power,
  };
}

function insideRail(position) {
  const x = clamp(position[0], -BOUNDS.x + 0.22, BOUNDS.x - 0.22);
  const z = clamp(position[2], -BOUNDS.z + 0.22, BOUNDS.z - 0.22);
  const cx = BOUNDS.x - BOUNDS.cornerRadius,
    cz = BOUNDS.z - BOUNDS.cornerRadius;
  if (Math.abs(x) > cx && Math.abs(z) > cz) {
    const dx = Math.abs(x) - cx,
      dz = Math.abs(z) - cz;
    const ratio = Math.min(
      1,
      (BOUNDS.cornerRadius - 0.22) / Math.hypot(dx, dz),
    );
    return [
      Math.sign(x) * (cx + dx * ratio),
      DICE_SIZE / 2 + 0.002,
      Math.sign(z) * (cz + dz * ratio),
    ];
  }
  return [x, DICE_SIZE / 2 + 0.002, z];
}

/**
 * Run the rigid bodies ONCE on the authority, at a fixed 120Hz. The serialized
 * 60Hz frames, including the conditioned final face orientation, are the source
 * of truth for all renderers. Clients never independently re-simulate a throw.
 */
export function createThrowTimeline({
  id,
  playerId,
  shooterId = playerId,
  seed,
  dice,
  gesture,
  startAt = Date.now(),
  duration = THROW_DURATION,
}) {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff)
    throw new Error("Invalid throw seed.");
  if (
    !Array.isArray(dice) ||
    dice.length !== 2 ||
    dice.some((n) => !Number.isInteger(n) || n < 1 || n > 6)
  )
    throw new Error("Invalid dice.");
  if (!Number.isFinite(startAt) || !Number.isFinite(duration) || duration < 0)
    throw new Error("Invalid throw timing.");
  const controls = sanitizeGesture(gesture);
  const physics = createDicePhysics();
  physics.throwDice(seed, controls);
  const raw = [];
  const samples = 150;
  for (let frame = 0; frame <= samples; frame++) {
    if (frame) {
      physics.step(1 / 120);
      physics.step(1 / 120);
    }
    raw.push(
      physics.bodies.map((body) => ({
        position: [body.position.x, body.position.y, body.position.z],
        quaternion: [
          body.quaternion.x,
          body.quaternion.y,
          body.quaternion.z,
          body.quaternion.w,
        ],
      })),
    );
  }
  // Leave enough room between the final footprint of both cubes as they square
  // up. The physical path is preserved through 80% of the visible flight.
  const target = raw[samples].map((pose, i) => ({
    position: insideRail(pose.position),
    quaternion: diceQuaternion(dice[i], ((seed >>> (i * 8)) % 6283) / 1000),
  }));
  if (
    Math.hypot(
      target[0].position[0] - target[1].position[0],
      target[0].position[2] - target[1].position[2],
    ) <
    DICE_SIZE * 1.5
  ) {
    target[0].position[0] -= DICE_SIZE * 0.8;
    target[1].position[0] += DICE_SIZE * 0.8;
    target.forEach((pose) => {
      pose.position = insideRail(pose.position);
    });
  }
  const settleStart = Math.floor(samples * 0.8);
  const frames = raw.map((poses, index) => {
    const t = clamp((index - settleStart) / (samples - settleStart), 0, 1);
    const ease = t * t * t * (t * (t * 6 - 15) + 10);
    const row = [rounded((index / samples) * duration)];
    poses.forEach((pose, i) => {
      const position = pose.position.map(
        (v, j) => v + (target[i].position[j] - v) * ease,
      );
      const quaternion = slerp(pose.quaternion, target[i].quaternion, ease);
      row.push(...position.map(rounded), ...quaternion.map(rounded));
    });
    return row;
  });
  return {
    version: 1,
    id,
    playerId,
    shooterId,
    seed,
    startAt,
    duration,
    dice: [...dice],
    gesture: controls,
    frames,
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
  return {
    dice,
    progress: duration ? elapsed / duration : 1,
    done: now >= startAt + duration,
    wallHits: throwState.wallHits,
  };
}
