import {
  World,
  Body,
  Box,
  Cylinder,
  Plane,
  Vec3,
  Quaternion,
  Material,
  ContactMaterial,
  SAPBroadphase,
} from "cannon-es";
import { DICE_SIZE } from "./dice-physics.js";
import { sampleThrow } from "./throw-motion.js";

// One-way presentation physics: the recorded dice drive kinematic bodies. They
// never receive impulses from these chips or alter the authoritative outcome.
export const CHIP_IMPACT_LIMITS = Object.freeze({
  stacks: 2,
  chips: 3,
  minimumSpeed: 1.5,
  minimumHeadOn: 0.9,
  physicsMs: 480,
  recoveryMs: 680,
  maxDisplacement: 0.28,
  maxLift: 0.16,
});
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const chipHeight = (chip) =>
  0.13 * chip.diameter * (chip.thicknessScale ?? 1.3);
const yHalf = (q) => {
  const [x, y, z, w] = q;
  return (
    (DICE_SIZE / 2) *
    (Math.abs(2 * (x * y + w * z)) +
      Math.abs(1 - 2 * (x * x + z * z)) +
      Math.abs(2 * (y * z - w * x)))
  );
};

/** Swept, height-aware approach test. The solver below must still confirm contact. */
export function findChipImpactCandidates(timeline, stacks) {
  if (!timeline?.frames?.length || !Number.isFinite(timeline.startAt))
    return [];
  const end =
    timeline.duration -
    CHIP_IMPACT_LIMITS.physicsMs -
    CHIP_IMPACT_LIMITS.recoveryMs;
  if (Array.isArray(timeline.stackContacts)) {
    const byId = new Map(stacks.map((stack) => [stack.id, stack]));
    const seen = new Set(),
      candidates = [];
    for (const contact of [...timeline.stackContacts].sort(
      (a, b) => a.time - b.time,
    )) {
      const id = contact.stackId ?? contact.id,
        stack = byId.get(id);
      if (
        !stack?.chips.length ||
        seen.has(id) ||
        !Number.isFinite(contact.time) ||
        contact.time < 0 ||
        contact.time > end ||
        !Number.isFinite(contact.speed) ||
        contact.speed < CHIP_IMPACT_LIMITS.minimumSpeed ||
        ![0, 1].includes(contact.die)
      )
        continue;
      if (
        !Array.isArray(contact.normal) ||
        contact.normal.length !== 3 ||
        !contact.normal.every(Number.isFinite)
      )
        continue;
      const velocity = contact.velocity;
      if (
        Array.isArray(velocity) &&
        velocity.length === 3 &&
        velocity.every(Number.isFinite)
      ) {
        const totalSpeed = Math.hypot(...velocity);
        if (
          totalSpeed &&
          contact.speed / totalSpeed < CHIP_IMPACT_LIMITS.minimumHeadOn
        )
          continue;
      }
      seen.add(id);
      candidates.push({
        stack,
        selected: stack.chips.slice(-CHIP_IMPACT_LIMITS.chips),
        time: contact.time,
        die: contact.die,
        speed: contact.speed,
        contact,
      });
      if (candidates.length === CHIP_IMPACT_LIMITS.stacks) break;
    }
    return candidates;
  }
  const candidates = [];
  for (const stack of stacks) {
    if (!stack.chips?.length) continue;
    const selected = stack.chips.slice(-CHIP_IMPACT_LIMITS.chips);
    const center = selected[0].position;
    const radius = selected[0].diameter / 2;
    const bottom = Math.min(
      ...selected.map((c) => c.position[1] - chipHeight(c) / 2),
    );
    const top = Math.max(
      ...selected.map((c) => c.position[1] + chipHeight(c) / 2),
    );
    let found = null;
    for (let i = 1; i < timeline.frames.length && !found; i++) {
      const a = timeline.frames[i - 1],
        b = timeline.frames[i],
        dt = (b[0] - a[0]) / 1000;
      if (a[0] > end) break;
      if (!(dt > 0)) continue;
      for (let die = 0; die < 2; die++) {
        const offset = 1 + die * 7;
        const p = a.slice(offset, offset + 3),
          q = b.slice(offset, offset + 3);
        const dx = q[0] - p[0],
          dz = q[2] - p[2],
          length = Math.hypot(dx, dz);
        const speed = length / dt;
        if (speed < CHIP_IMPACT_LIMITS.minimumSpeed) continue;
        const tx = center[0] - p[0],
          tz = center[2] - p[2];
        const along = (tx * dx + tz * dz) / (length * length);
        const t = clamp(along, 0, 1);
        const closest = Math.hypot(tx - dx * t, tz - dz * t);
        // Hit the central portion rather than brushing a stack's outer edge.
        if (closest > radius * 0.62) continue;
        const reach = radius + DICE_SIZE * 0.56;
        const entry =
          along -
          Math.sqrt(Math.max(0, reach * reach - closest * closest)) / length;
        if (entry > 1 || along < 0) continue;
        const contact = clamp(entry, 0, 1);
        const cx = tx - dx * contact,
          cz = tz - dz * contact;
        const headOn =
          (cx * dx + cz * dz) / (Math.max(1e-8, Math.hypot(cx, cz)) * length);
        if (headOn < CHIP_IMPACT_LIMITS.minimumHeadOn) continue;
        const time = a[0] + (b[0] - a[0]) * contact;
        if (time > end) continue;
        const height = p[1] + (q[1] - p[1]) * contact;
        const half = Math.max(
          yHalf(a.slice(offset + 3, offset + 7)),
          yHalf(b.slice(offset + 3, offset + 7)),
        );
        if (height - half > top + 0.006 || height + half < bottom - 0.006)
          continue;
        found = { stack, selected, time, die, speed };
        break;
      }
    }
    if (found) candidates.push(found);
  }
  return candidates
    .sort(
      (a, b) =>
        a.time - b.time || String(a.stack.id).localeCompare(String(b.stack.id)),
    )
    .slice(0, CHIP_IMPACT_LIMITS.stacks);
}

const pose = (body) => ({
  position: body.position.toArray(),
  quaternion: body.quaternion.toArray(),
});
function simulateContact(timeline, candidate) {
  const { stack, selected } = candidate;
  const world = new World({ gravity: new Vec3(0, -9.81, 0) });
  world.broadphase = new SAPBroadphase(world);
  world.allowSleep = true;
  world.solver.iterations = 12;
  const clay = new Material("clay"),
    resin = new Material("resin"),
    felt = new Material("felt");
  world.addContactMaterial(
    new ContactMaterial(clay, clay, { friction: 0.7, restitution: 0.02 }),
  );
  world.addContactMaterial(
    new ContactMaterial(clay, resin, { friction: 0.4, restitution: 0.04 }),
  );
  world.addContactMaterial(
    new ContactMaterial(clay, felt, { friction: 0.8, restitution: 0.015 }),
  );
  const floorY =
    stack.floorY ??
    Math.min(...stack.chips.map((c) => c.position[1] - chipHeight(c) / 2));
  const floor = new Body({
    mass: 0,
    material: felt,
    shape: new Plane(),
    collisionFilterGroup: 4,
    collisionFilterMask: 2,
  });
  floor.position.y = floorY;
  floor.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
  world.addBody(floor);
  const lower = stack.chips.slice(0, -selected.length);
  if (lower.length) {
    const top = Math.max(
      ...lower.map((c) => c.position[1] + chipHeight(c) / 2),
    );
    const support = new Body({
      mass: 0,
      material: clay,
      shape: new Cylinder(
        selected[0].diameter / 2,
        selected[0].diameter / 2,
        top - floorY,
        16,
      ),
      collisionFilterGroup: 4,
      collisionFilterMask: 2,
    });
    support.position.set(
      selected[0].position[0],
      floorY + (top - floorY) / 2,
      selected[0].position[2],
    );
    world.addBody(support);
  }
  const dice = [0, 1].map(() => {
    const body = new Body({
      type: Body.KINEMATIC,
      mass: 0,
      material: resin,
      shape: new Box(new Vec3(DICE_SIZE / 2, DICE_SIZE / 2, DICE_SIZE / 2)),
      collisionFilterGroup: 1,
      collisionFilterMask: 2,
    });
    world.addBody(body);
    return body;
  });
  const bodies = selected.map((chip) => {
    const body = new Body({
      mass: 0.011,
      material: clay,
      shape: new Cylinder(
        chip.diameter / 2,
        chip.diameter / 2,
        chipHeight(chip),
        16,
      ),
      linearDamping: 0.45,
      angularDamping: 0.5,
      collisionFilterGroup: 2,
      collisionFilterMask: 7,
    });
    body.position.set(...chip.position);
    body.quaternion.setFromEuler(...(chip.rotation || [0, 0, 0]));
    world.addBody(body);
    return body;
  });
  const original = bodies.map(pose);
  let contactAt = null,
    currentTime = 0;
  for (const body of bodies)
    body.addEventListener("collide", (event) => {
      if (dice.includes(event.body) && contactAt === null)
        contactAt = currentTime;
    });
  const start = Math.max(0, candidate.time - 35),
    dt = 1 / 240;
  const samples = [];
  const delta = new Quaternion(),
    inverse = new Quaternion(),
    axis = new Vec3();
  const until = Math.min(
    start + CHIP_IMPACT_LIMITS.physicsMs + 50,
    timeline.duration - CHIP_IMPACT_LIMITS.recoveryMs,
  );
  let transmitted = false;
  for (let time = start; time <= until; time += dt * 1000) {
    currentTime = time;
    const current = sampleThrow(timeline, timeline.startAt + time),
      next = sampleThrow(timeline, timeline.startAt + time + dt * 1000);
    dice.forEach((body, i) => {
      const p = current.dice[i],
        q = next.dice[i];
      body.position.set(...p.position);
      body.quaternion.set(...p.quaternion);
      body.velocity.set(
        (q.position[0] - p.position[0]) / dt,
        (q.position[1] - p.position[1]) / dt,
        (q.position[2] - p.position[2]) / dt,
      );
      body.quaternion.inverse(inverse);
      new Quaternion(...q.quaternion).mult(inverse, delta);
      delta.normalize();
      delta.toAxisAngle(axis);
      const angle = 2 * Math.acos(clamp(delta.w, -1, 1));
      body.angularVelocity
        .copy(axis)
        .scale(Math.min(angle, Math.PI) / dt, body.angularVelocity);
      body.aabbNeedsUpdate = true;
    });
    if (candidate.contact && !transmitted && time >= candidate.time) {
      transmitted = true;
      // The authority's solid cylinder can stop a die before the selected top
      // chips touch its replayed body. Transmit that real contact through the
      // stack, instead of requiring an impossible second geometric intrusion.
      {
        contactAt ??= candidate.time;
        const normal = new Vec3(...candidate.contact.normal);
        if (normal.lengthSquared() > 0) normal.normalize();
        const kick = clamp(candidate.speed * 0.16, 0.2, 0.8);
        bodies.forEach((body, index) => {
          const radius = selected[index].diameter / 2;
          const impulse = normal.scale(-body.mass * kick);
          const point = new Vec3(
            normal.x * radius * 0.7,
            -chipHeight(selected[index]) * 0.5,
            normal.z * radius * 0.7,
          );
          body.applyImpulse(impulse, point);
        });
      }
    }
    world.step(dt);
    bodies.forEach((body, i) => {
      // Keep this cosmetic collision local: no chips can leave their betting area.
      const initial = original[i].position,
        dx = body.position.x - initial[0],
        dz = body.position.z - initial[2],
        distance = Math.hypot(dx, dz);
      if (distance > CHIP_IMPACT_LIMITS.maxDisplacement) {
        const scale = CHIP_IMPACT_LIMITS.maxDisplacement / distance;
        body.position.x = initial[0] + dx * scale;
        body.position.z = initial[2] + dz * scale;
        body.velocity.x *= 0.15;
        body.velocity.z *= 0.15;
      }
      body.position.y = clamp(
        body.position.y,
        floorY + chipHeight(selected[i]) / 2,
        initial[1] + CHIP_IMPACT_LIMITS.maxLift,
      );
      const speed = body.velocity.length();
      if (speed > 0.8) body.velocity.scale(0.8 / speed, body.velocity);
      const spin = body.angularVelocity.length();
      if (spin > 7) body.angularVelocity.scale(7 / spin, body.angularVelocity);
    });
    if (
      contactAt !== null &&
      Math.round((time - start) / (dt * 1000)) % 4 === 0
    )
      samples.push({ time: time - contactAt, poses: bodies.map(pose) });
  }
  if (contactAt === null || !samples.length) return null;
  samples.unshift({ time: 0, poses: original });
  return {
    id: `${timeline.id}:${stack.id}`,
    stackId: stack.id,
    startAt: timeline.startAt + contactAt,
    original,
    chipIds: selected.map((c) => c.id),
    frames: samples,
    physicsMs: samples.at(-1).time,
    recoveryMs: CHIP_IMPACT_LIMITS.recoveryMs,
  };
}

export function createChipImpacts(timeline, stacks) {
  return findChipImpactCandidates(timeline, stacks)
    .map((candidate) => simulateContact(timeline, candidate))
    .filter(Boolean);
}

/** Stateless sampling keeps slow/fast renderers and mid-throw joins in agreement. */
export function sampleChipImpact(track, now) {
  const elapsed = now - track.startAt;
  if (elapsed < 0) return { active: false, done: false, poses: track.original };
  if (elapsed >= track.physicsMs + track.recoveryMs)
    return { active: false, done: true, poses: track.original };
  let a, b, t;
  if (elapsed <= track.physicsMs) {
    let i = 0;
    while (i + 1 < track.frames.length && track.frames[i + 1].time <= elapsed)
      i++;
    a = track.frames[i];
    b = track.frames[Math.min(i + 1, track.frames.length - 1)];
    t =
      b.time === a.time
        ? 0
        : clamp((elapsed - a.time) / (b.time - a.time), 0, 1);
  } else {
    a = track.frames.at(-1);
    b = { poses: track.original };
    const p = (elapsed - track.physicsMs) / track.recoveryMs;
    t = p * p * (3 - 2 * p);
  }
  return {
    active: true,
    done: false,
    poses: a.poses.map((p, i) => {
      const q = new Quaternion(...p.quaternion);
      q.slerp(new Quaternion(...b.poses[i].quaternion), t, q);
      return {
        position: p.position.map(
          (v, axis) => v + (b.poses[i].position[axis] - v) * t,
        ),
        quaternion: q.toArray(),
      };
    }),
  };
}
