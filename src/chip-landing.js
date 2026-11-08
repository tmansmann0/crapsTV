import {
  World,
  Body,
  Cylinder,
  Plane,
  Vec3,
  Material,
  ContactMaterial,
} from "cannon-es";
import { chipHash, chipPoseBounds } from "./chip-character.js";

export const CHIP_LANDING_LIMITS = Object.freeze({
  gravity: 9.81,
  drop: 0.15,
  staggerMs: 80,
  reactionChips: 3,
  reactionMs: 420,
  recoveryMs: 160,
  maxSlide: 0.005,
  // Conservative cylinder envelopes add vertical clearance for tilt. Keeping
  // this below .5deg prevents a rapid cohort from accumulating a tall ripple.
  maxTilt: 0.0035,
  bounce: 0.003,
  maxBodies: 4,
});
const L = CHIP_LANDING_LIMITS;
const kernels = new Map();
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const smooth = (value) => {
  const t = clamp(value, 0, 1);
  return t * t * (3 - 2 * t);
};
const height = (chip) =>
  (chip.diameter ?? 0.31) * (chip.thicknessScale ?? 1.3) * 0.13;
const fallMs = Math.sqrt((2 * L.drop) / L.gravity) * 1000;

function quaternion([x, y, z], out) {
  const a = Math.cos(x / 2),
    b = Math.cos(y / 2),
    c = Math.cos(z / 2);
  const d = Math.sin(x / 2),
    e = Math.sin(y / 2),
    f = Math.sin(z / 2);
  out[0] = d * b * c + a * e * f;
  out[1] = a * e * c - d * b * f;
  out[2] = a * b * f + d * e * c;
  out[3] = a * b * c - d * e * f;
}
function halfY(chip, rotation) {
  const [x, y, z] = rotation;
  const axis =
    Math.cos(x) * Math.cos(z) - Math.sin(x) * Math.sin(y) * Math.sin(z);
  return (
    ((chip.diameter ?? 0.31) / 2) * Math.sqrt(Math.max(0, 1 - axis * axis)) +
    (height(chip) / 2) * Math.abs(axis)
  );
}
function tilt(body) {
  // Small-angle motion around the reference upright cylinder. Its world yaw
  // is intentionally left to the chip's stable art/identity orientation.
  const q = body.quaternion;
  return [2 * Math.atan2(q.x, q.w), 2 * Math.atan2(q.z, q.w)];
}

/** One short real collision shared by all arrivals of these physical dimensions. */
function responseFor(chip, count) {
  const diameter = chip.diameter ?? 0.31,
    h = height(chip);
  const key = `${diameter.toFixed(6)}:${h.toFixed(6)}:${count}`;
  if (kernels.has(key)) return kernels.get(key);
  const world = new World({ gravity: new Vec3(0, -L.gravity, 0) });
  world.solver.iterations = 12;
  const clay = new Material("landing clay");
  world.addContactMaterial(
    new ContactMaterial(clay, clay, {
      friction: 0.62,
      restitution: 0.14,
      contactEquationStiffness: 1e8,
      contactEquationRelaxation: 3,
    }),
  );
  const floor = new Body({ mass: 0, material: clay, shape: new Plane() });
  floor.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
  world.addBody(floor);
  const bodies = [];
  for (let index = 0; index <= count; index++) {
    const body = new Body({
      mass: 0.011,
      material: clay,
      shape: new Cylinder(diameter / 2, diameter / 2, h, 12),
      linearDamping: 0.5,
      angularDamping: 0.65,
    });
    body.position.set(
      0,
      h / 2 + index * (h + 0.0008) + (index === count ? L.drop : 0),
      0,
    );
    if (index === count) {
      body.velocity.set(0.055, 0, 0.018);
      body.angularVelocity.set(0.06, 0.3, -0.04);
    }
    world.addBody(body);
    bodies.push(body);
  }
  const incoming = bodies[count];
  let contactAt = null,
    clock = 0;
  incoming.addEventListener("collide", () => {
    contactAt ??= clock;
  });
  const frames = [],
    dt = 1 / 240;
  let origin = null;
  for (
    let tick = 0;
    tick <= Math.ceil((fallMs + L.reactionMs) / (dt * 1000));
    tick++
  ) {
    clock = tick * dt * 1000;
    world.step(dt);
    if (contactAt === null) continue;
    if (!origin)
      origin = bodies.map((body) => ({
        x: body.position.x,
        z: body.position.z,
        tilt: tilt(body),
      }));
    if (tick % 2) continue;
    frames.push({
      time: clock - contactAt,
      poses: bodies.map((body, index) => {
        const angles = tilt(body),
          base = origin[index];
        return [
          body.position.x - base.x,
          body.position.z - base.z,
          angles[0] - base.tilt[0],
          angles[1] - base.tilt[1],
        ];
      }),
    });
  }
  // A failed reference contact must never invent an underlying stack impulse.
  const kernel = {
    contact: contactAt !== null,
    bodyCount: bodies.length,
    frames,
  };
  kernels.set(key, kernel);
  if (kernels.size > 16) kernels.delete(kernels.keys().next().value);
  return kernel;
}

function response(kernel, time, index, channel) {
  if (!kernel.contact || !kernel.frames.length || time < 0) return 0;
  const frames = kernel.frames;
  const row = clamp(Math.floor(time / (1000 / 120)), 0, frames.length - 1);
  // Use the actual recorded timestamps: the first collision can occur between
  // the fixed output ticks, and callers can seek in either direction.
  let i = row;
  while (i > 0 && frames[i].time > time) i--;
  while (i + 1 < frames.length && frames[i + 1].time <= time) i++;
  const a = frames[i],
    b = frames[Math.min(i + 1, frames.length - 1)];
  const t =
    b.time === a.time ? 0 : clamp((time - a.time) / (b.time - a.time), 0, 1);
  return (
    a.poses[index][channel] +
    (b.poses[index][channel] - a.poses[index][channel]) * t
  );
}

/** Optional stage warmup: populate the small dimension cache off the live path. */
export function prewarmChipLandingResponses(chips) {
  const dimensions = new Set();
  let prepared = 0;
  for (const chip of chips) {
    const key = `${chip.diameter ?? 0.31}:${chip.thicknessScale ?? 1.3}`;
    if (dimensions.has(key)) continue;
    dimensions.add(key);
    for (let count = 0; count <= L.reactionChips; count++) {
      responseFor(chip, count);
      prepared++;
    }
  }
  return prepared;
}

/**
 * Final stable descriptors define the stack bottom-to-top. Only added IDs are
 * arrivals; existing IDs/denominations and all lower base poses stay intact.
 * StartAt is supplied by the presentation clock, never read from wall time.
 * A plan contains no live physics bodies and is structured-clone/seek safe.
 */
export function createChipLandingPlan({
  stacks = [],
  addedIds,
  added = [],
  startAt,
  staggerMs = L.staggerMs,
  previousPlan = null,
} = {}) {
  if (!Number.isFinite(startAt))
    throw new Error("Chip landing requires a finite startAt");
  const wanted = new Set(
    addedIds ??
      added.map((chip) => (typeof chip === "object" ? chip.id : chip)),
  );
  const tracks = [],
    ids = new Set();
  const continuing = new Map();
  for (const track of previousPlan?.tracks ?? []) {
    const events = new Map();
    for (const event of track.events) {
      if (event.endAt <= startAt) continue;
      const id = track.rows[event.row].id;
      wanted.add(id);
      events.set(id, event);
    }
    continuing.set(track.id, events);
  }
  let settlingUntil = startAt,
    firstStartAt = startAt;
  // A transfer can deliver an already-stacked handful in one cohort. Its
  // flight and receiving stack must share that exact simultaneous contact.
  const stagger =
    staggerMs === 0
      ? 0
      : clamp(Number.isFinite(staggerMs) ? staggerMs : L.staggerMs, 60, 180);
  for (const stack of stacks) {
    const chips = stack.chips ?? [];
    const additions = chips
      .map((chip, index) => (wanted.has(chip.id) ? index : -1))
      .filter((index) => index >= 0);
    if (!additions.length) continue;
    // Append-only arrivals cannot animate an inserted chip through an existing
    // chip above it. Inventory reconciliation handles withdrawals separately.
    const first = additions[0];
    if (chips.slice(first).some((chip) => !wanted.has(chip.id)))
      throw new Error("Chip landings must append to a stable stack");
    const from = Math.max(0, first - L.reactionChips);
    const rows = [],
      events = [];
    const support = from
      ? chipPoseBounds(chips[from - 1]).max[1]
      : (stack.floorY ?? chipPoseBounds(chips[0]).min[1]);
    let previousTop = support;
    for (let index = from; index < chips.length; index++) {
      const chip = chips[index];
      if (chip.id === undefined || ids.has(chip.id))
        throw new Error("Chip landing IDs must be unique");
      ids.add(chip.id);
      if (
        !chip.position?.every(Number.isFinite) ||
        chip.position.length !== 3 ||
        !(chip.diameter ?? 0.31) ||
        height(chip) <= 0
      )
        throw new Error("Invalid chip landing geometry");
      const baseRotation = [...(chip.rotation ?? [0, 0, 0])];
      if (baseRotation.length !== 3 || !baseRotation.every(Number.isFinite))
        throw new Error("Invalid chip landing rotation");
      const bounds = chipPoseBounds(chip),
        gap = bounds.min[1] - previousTop;
      if (gap < -1e-6) throw new Error("Stable landing stack poses intersect");
      const baseQuaternion = [0, 0, 0, 1];
      quaternion(baseRotation, baseQuaternion);
      rows.push({
        id: chip.id,
        diameter: chip.diameter ?? 0.31,
        thicknessScale: chip.thicknessScale ?? 1.3,
        basePosition: [...chip.position],
        baseRotation,
        baseQuaternion,
        gap: Math.max(0, gap),
        position: [...chip.position],
        rotation: [...baseRotation],
        quaternion: [...baseQuaternion],
        visible: true,
        added: wanted.has(chip.id),
        startAt: Infinity,
      });
      previousTop = bounds.max[1];
    }
    let nextStartAt = startAt;
    const priorEvents = continuing.get(stack.id);
    for (const index of additions) {
      const row = index - from,
        count = Math.min(index, L.reactionChips);
      const prior = priorEvents?.get(chips[index].id);
      const at = prior?.startAt ?? nextStartAt;
      nextStartAt = Math.max(startAt, at + stagger);
      firstStartAt = Math.min(firstStartAt, at);
      const angle =
        (chipHash(`${stack.id}:${chips[index].id}:landing`) / 4294967295) *
        Math.PI *
        2;
      const kernel = prior?.kernel ?? responseFor(chips[index], count);
      events.push({
        row,
        count,
        startAt: at,
        contactAt: at + fallMs,
        endAt: at + fallMs + L.reactionMs + L.recoveryMs,
        cosine: Math.cos(angle),
        sine: Math.sin(angle),
        kernel,
      });
      rows[row].startAt = at;
      settlingUntil = Math.max(settlingUntil, events.at(-1).endAt);
    }
    tracks.push({ id: stack.id, support, rows, events });
  }
  return {
    startAt: firstStartAt,
    settlingUntil,
    tracks,
    chipIds: [...ids],
    maxPhysicsBodies: tracks.length ? L.maxBodies : 0,
    boundsPadding: L.drop + 0.015,
  };
}

/**
 * Allocation-free sampling for existing instance-matrix buffers. The callback
 * receives (id, reusablePose), including visible=false for queued arrivals.
 * Copy a pose if it must outlive this call. No renderer or batch is created.
 */
export function writeChipLandingPoses(plan, now, write) {
  if (!Number.isFinite(now))
    throw new Error("Chip landing sample time must be finite");
  for (const track of plan.tracks) {
    for (const row of track.rows) {
      for (let axis = 0; axis < 3; axis++) {
        row.position[axis] = row.basePosition[axis];
        row.rotation[axis] = row.baseRotation[axis];
      }
      for (let axis = 0; axis < 4; axis++)
        row.quaternion[axis] = row.baseQuaternion[axis];
      row.visible = !row.added || now >= row.startAt;
    }
    for (const event of track.events) {
      if (now < event.startAt || now >= event.endAt) continue;
      const arrival = track.rows[event.row],
        elapsed = now - event.startAt;
      if (elapsed < fallMs) {
        arrival.position[1] += L.drop - 0.5 * L.gravity * (elapsed / 1000) ** 2;
      } else {
        // A restitution-sized ballistic rebound, gated by confirmed contact in
        // the cached four-body solve. It cannot sink below the final support.
        if (event.kernel.contact) {
          const t = (elapsed - fallMs) / 1000,
            velocity = Math.sqrt(2 * L.gravity * L.bounce);
          arrival.position[1] += Math.max(
            0,
            velocity * t - 0.5 * L.gravity * t * t,
          );
        }
      }
      const sinceContact = now - event.contactAt;
      if (sinceContact < 0 || !event.kernel.contact) continue;
      const gain = 1 - smooth((sinceContact - L.reactionMs) / L.recoveryMs);
      const ramp = smooth(sinceContact / 24);
      for (let offset = 0; offset <= event.count; offset++) {
        const row = track.rows[event.row - event.count + offset];
        const dx =
          clamp(
            response(event.kernel, sinceContact, offset, 0) * 1.8,
            -L.maxSlide,
            L.maxSlide,
          ) *
          gain *
          ramp;
        const dz =
          clamp(
            response(event.kernel, sinceContact, offset, 1) * 1.8,
            -L.maxSlide,
            L.maxSlide,
          ) *
          gain *
          ramp;
        row.position[0] += dx * event.cosine - dz * event.sine;
        row.position[2] += dx * event.sine + dz * event.cosine;
        const tx =
          clamp(
            response(event.kernel, sinceContact, offset, 2),
            -L.maxTilt,
            L.maxTilt,
          ) *
          gain *
          ramp;
        const tz =
          clamp(
            response(event.kernel, sinceContact, offset, 3),
            -L.maxTilt,
            L.maxTilt,
          ) *
          gain *
          ramp;
        row.rotation[0] += tx * event.cosine - tz * event.sine;
        row.rotation[2] += tx * event.sine + tz * event.cosine;
      }
    }
    let support = track.support;
    for (const row of track.rows) {
      if (!row.visible) {
        write(row.id, row);
        continue;
      }
      const dx = row.position[0] - row.basePosition[0],
        dz = row.position[2] - row.basePosition[2];
      const slide = Math.hypot(dx, dz);
      if (slide > L.maxSlide) {
        row.position[0] = row.basePosition[0] + (dx * L.maxSlide) / slide;
        row.position[2] = row.basePosition[2] + (dz * L.maxSlide) / slide;
      }
      const tx = row.rotation[0] - row.baseRotation[0],
        tz = row.rotation[2] - row.baseRotation[2];
      const angle = Math.hypot(tx, tz);
      if (angle > L.maxTilt) {
        row.rotation[0] = row.baseRotation[0] + (tx * L.maxTilt) / angle;
        row.rotation[2] = row.baseRotation[2] + (tz * L.maxTilt) / angle;
      }
      const half = halfY(row, row.rotation);
      // Conservative tilted-cylinder envelopes enforce contact even between
      // output ticks and while several staggered arrivals share the top stack.
      row.position[1] = Math.max(row.position[1], support + row.gap + half);
      if (Math.abs(row.position[1] - row.basePosition[1]) < 1e-12)
        row.position[1] = row.basePosition[1];
      support = row.position[1] + half;
      if (now >= plan.settlingUntil) {
        for (let axis = 0; axis < 3; axis++) {
          row.position[axis] = row.basePosition[axis];
          row.rotation[axis] = row.baseRotation[axis];
        }
        for (let axis = 0; axis < 4; axis++)
          row.quaternion[axis] = row.baseQuaternion[axis];
      } else quaternion(row.rotation, row.quaternion);
      write(row.id, row);
    }
  }
  return now >= plan.startAt && now < plan.settlingUntil;
}

/** Convenient immutable snapshot for inspection/tests; renderers use the writer. */
export function sampleChipLanding(plan, now) {
  const poses = [];
  const active = writeChipLandingPoses(plan, now, (id, pose) =>
    poses.push({
      id,
      visible: pose.visible,
      position: [...pose.position],
      rotation: [...pose.rotation],
      quaternion: [...pose.quaternion],
    }),
  );
  return {
    active,
    done: now >= plan.settlingUntil,
    poses,
    settlingUntil: plan.settlingUntil,
  };
}
