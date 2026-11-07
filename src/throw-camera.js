import { SEAT_LAYOUT, arcPosition } from "./chip-flow.js";
import { wagerPosition } from "./wager-layout.js";
import { planOutcomeTour, sampleOutcomeTour } from "./round-presentation.js";

// Table-level rigs are inside the cushion corners. A recorded trajectory
// chooses one rig for the entire throw; the camera never chases the dice.
export const THROW_CAMERA_RIGS = Object.freeze([
  Object.freeze([5.0, 0.38, 2.3]),
  Object.freeze([-5.0, 0.38, 2.3]),
  Object.freeze([-5.0, 0.38, -2.3]),
  Object.freeze([5.0, 0.38, -2.3]),
]);
export const RESULT_CAMERA_HOLD_MS = 1600;
export const BETWEEN_ROUND_BREATHER_MS = 1000;
const radians = (degrees) => (degrees * Math.PI) / 180;
const degrees = (angle) => (angle * 180) / Math.PI;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const smooth = (value) => value * value * (3 - 2 * value);
const hash = (value) =>
  [...String(value)].reduce(
    (n, char) => (Math.imul(n, 31) + char.charCodeAt(0)) >>> 0,
    0,
  );
export const IDLE_PLAYER_SHOT_MS = 3000;
export const IDLE_OVERVIEW_MS = 1200;
export const IDLE_MAX_SHOTS = 3;
const outcomePlanCache = new Map();
const idlePlanCache = new Map();

export function planFiniteIdleCamera(
  state,
  { presentation, origin = 0, onlyPlayerIds = null } = {},
) {
  const featured = new Set(
    (presentation?.slots || [])
      .filter((slot) => slot.kind === "player")
      .flatMap((slot) => slot.playerIds || [slot.playerId]),
  );
  const events = new Map(
    (state.lastRoll?.events || []).map((event) => [event.playerId, event]),
  );
  const candidates = (state.players || []).filter(
    (player) =>
      !player.left &&
      player.connected !== false &&
      !featured.has(player.id) &&
      (onlyPlayerIds
        ? onlyPlayerIds.includes(player.id)
        : player.bets?.length ||
          player.betPreview?.amount ||
          events.get(player.id)?.bets?.length),
  );
  candidates.sort(
    (a, b) =>
      Number(!!b.betPreview?.amount) - Number(!!a.betPreview?.amount) ||
      Math.abs(events.get(b.id)?.delta || 0) -
        Math.abs(events.get(a.id)?.delta || 0) ||
      a.seat - b.seat ||
      a.id.localeCompare(b.id),
  );
  const seed =
    state.lastRoll?.id ||
    `${state.code}:${state.bettingOpenedAt || state.createdAt || 0}`;
  const count = Math.min(
    candidates.length,
    IDLE_MAX_SHOTS,
    1 + (hash(seed) % IDLE_MAX_SHOTS),
  );
  const id = `idle:${seed}:${origin}:${onlyPlayerIds?.join(",") || "round"}`;
  const slots = candidates
    .slice(0, count)
    .map((player, index) => ({
      playerId: player.id,
      seat: player.seat,
      name: player.name,
      startAt: origin + IDLE_OVERVIEW_MS + index * IDLE_PLAYER_SHOT_MS,
      endAt: origin + IDLE_OVERVIEW_MS + (index + 1) * IDLE_PLAYER_SHOT_MS,
      index,
    }));
  return { id, startAt: origin, endAt: slots.at(-1)?.endAt ?? origin, slots };
}

function finiteIdleCameraPlan(state, presentation, origin, now) {
  const key = `${state.code || "table"}:${state.createdAt || 0}:${state.lastRoll?.id || state.bettingOpenedAt || "open"}`;
  const players = (state.players || []).filter(
    (player) => !player.left && player.connected !== false,
  );
  const ids = players.map((player) => player.id);
  const active = players.some(
    (player) =>
      player.bets?.length ||
      player.betPreview?.amount ||
      (state.lastRoll?.events || []).some(
        (event) => event.playerId === player.id && event.bets?.length,
      ),
  );
  let cached = idlePlanCache.get(key);
  if (!cached) {
    cached = {
      known: new Set(ids),
      consumed: active,
      plan: planFiniteIdleCamera(state, { presentation, origin }),
    };
    idlePlanCache.set(key, cached);
    if (idlePlanCache.size > 64)
      idlePlanCache.delete(idlePlanCache.keys().next().value);
  } else {
    const newcomers = ids.filter((id) => !cached.known.has(id));
    ids.forEach((id) => cached.known.add(id));
    if (newcomers.length) {
      const at = Math.max(
        origin,
        ...players
          .filter((player) => newcomers.includes(player.id))
          .map((player) =>
            Number.isFinite(player.joinedAt)
              ? player.joinedAt
              : (state.snapshotAt ?? now),
          ),
      );
      cached.plan = planFiniteIdleCamera(state, {
        presentation,
        origin: at,
        onlyPlayerIds: newcomers,
      });
      cached.consumed = true;
    } else if (!cached.consumed && active) {
      cached.plan = planFiniteIdleCamera(state, {
        presentation,
        origin: Math.max(origin, state.snapshotAt ?? now),
      });
      cached.consumed = true;
    }
  }
  return cached.plan;
}

export function outcomePresentation(state) {
  if (state?.lastRoll?.presentation) return state.lastRoll.presentation;
  if (!state?.lastRoll) return null;
  const key = `${state.lastRoll.id}:${state.nextRollAt}`;
  if (!outcomePlanCache.has(key)) {
    outcomePlanCache.set(
      key,
      planOutcomeTour(state, {
        deadline: state.nextRollAt,
        mode: "fit-window",
      }),
    );
    if (outcomePlanCache.size > 32)
      outcomePlanCache.delete(outcomePlanCache.keys().next().value);
  }
  return outcomePlanCache.get(key);
}

function routeFocus(route, state) {
  if (route.kind === "dealer") return [0, 1.2, -3.03];
  if (route.kind === "bank") {
    const player = (state.players || []).find(
      (player) => player.id === route.playerId,
    );
    const area = SEAT_LAYOUT[player?.seat ?? 0] || SEAT_LAYOUT[0];
    return [area.center[0], area.center[1] + 0.13, area.center[2]];
  }
  const point = wagerPosition(route, state);
  point[1] += 0.12;
  return point;
}

function safeVerticalFraction(viewportHeight, hudRects) {
  if (!viewportHeight || !hudRects.length) return 0.8;
  let top = 0,
    bottom = viewportHeight;
  for (const rect of hudRects) {
    if (rect.y + rect.height <= viewportHeight * 0.5)
      top = Math.max(top, rect.y + rect.height);
    else if (rect.y >= viewportHeight * 0.5) bottom = Math.min(bottom, rect.y);
  }
  return Math.max(
    0.3,
    Math.min(1 - (2 * top) / viewportHeight, (2 * bottom) / viewportHeight - 1),
  );
}

/** Frame the selected player's complete transfer paths, not only the bank. */
export function sampleOutcomeCamera({
  state,
  plan,
  sample,
  now,
  aspect = 16 / 9,
  viewportHeight = 0,
  hudRects = [],
}) {
  const slot = sample.slot;
  const memberIds = slot.playerIds || [slot.playerId];
  const events = (state.lastRoll?.events || []).filter((event) =>
    memberIds.includes(event.playerId),
  );
  const metadata = {
    name: slot.name,
    delta: slot.delta,
    outcome: slot.outcome,
    betLabels: slot.betLabels || [],
    playerId: slot.playerId,
    playerIds: slot.playerIds,
    style: slot.style || (slot.kind === "group" ? "overview" : "individual"),
    reason: slot.reason || "individual",
    region: slot.focus?.region,
    bets: events
      .flatMap((event) => event.bets || [])
      .map((bet) => ({
        label: bet.label || bet.type || "Bet",
        result: bet.result,
      })),
    playerCount: slot.playerIds?.length || 1,
    shotIndex: sample.index,
    shotCount: plan.slots.length,
    progress: sample.progress,
    transferProgress: sample.transferProgress,
    shotKey: `outcome:${plan.rollId}:${sample.index}`,
  };
  if (slot.kind === "group" && (!slot.style || slot.style === "overview")) {
    let top = 0.13,
      bottom = 0.88;
    if (viewportHeight && hudRects.length) {
      top = 0;
      bottom = 1;
      for (const rect of hudRects) {
        if (rect.y + rect.height <= viewportHeight * 0.5)
          top = Math.max(top, (rect.y + rect.height) / viewportHeight);
        else if (rect.y >= viewportHeight * 0.5)
          bottom = Math.min(bottom, rect.y / viewportHeight);
      }
    }
    return {
      ...fitBettingCamera({
        aspect,
        top,
        bottom,
        bounds: { min: [-7.35, 0, -3.65], max: [7.35, 2.7, 4.65] },
      }),
      ...metadata,
      phase: "outcome-group",
    };
  }
  const player =
    (state.players || []).find((player) => player.id === slot.playerId) || slot;
  const transfers = plan.transfers.filter((flow) =>
    memberIds.includes(flow.playerId),
  );
  if (!transfers.length && slot.kind !== "group")
    return {
      ...samplePlayerAreaCamera({
        player,
        slot,
        now,
        roundId: plan.rollId,
        aspect,
      }),
      ...metadata,
    };
  let points = transfers.flatMap((flow) => {
    const from = routeFocus(flow.from, state),
      to = routeFocus(flow.to, state);
    return [0, 0.25, 0.5, 0.75, 1].map((progress) =>
      arcPosition(from, to, progress),
    );
  });
  const members = memberIds
    .map(
      (id) =>
        (state.players || []).find((player) => player.id === id) ||
        slot.members?.find((member) => member.playerId === id),
    )
    .filter(Boolean);
  if (!points.length)
    points = members.flatMap((member) => {
      const area = SEAT_LAYOUT[member.seat] || SEAT_LAYOUT[0];
      return [-0.7, 0.7].flatMap((along) =>
        [0.675, 1.9].map((y) => [
          area.center[0] + area.tangent[0] * along,
          y,
          area.center[2] + area.tangent[2] * along,
        ]),
      );
    });
  const min = [0, 1, 2].map((axis) =>
      Math.min(...points.map((point) => point[axis])),
    ),
    max = [0, 1, 2].map((axis) =>
      Math.max(...points.map((point) => point[axis])),
    );
  const target = min.map((value, axis) => (value + max[axis]) / 2);
  const area =
    SEAT_LAYOUT[slot.seat ?? player.seat ?? members[0]?.seat ?? 0] ||
    SEAT_LAYOUT[0];
  let outward = [...area.outward];
  if (slot.kind === "group") {
    const region = slot.focus?.region || slot.reason;
    if (region === "left") outward = [-1, 0, 0];
    else if (region === "right") outward = [1, 0, 0];
    else if (region === "front") outward = [0, 0, 1];
    else {
      outward = members.reduce(
        (sum, member) => {
          const bank = SEAT_LAYOUT[member.seat] || SEAT_LAYOUT[0];
          return sum.map((value, axis) => value + bank.outward[axis]);
        },
        [0, 0, 0],
      );
      const span = Math.hypot(outward[0], outward[2]);
      outward = span > 0.1 ? outward.map((value) => value / span) : [0, 0, 1];
    }
  }
  const tangentDirection = [outward[2], 0, -outward[0]];
  const variation =
    ((hash(`${plan.rollId}:${sample.index}:${slot.playerId}`) % 3) - 1) * 0.18;
  const direction = [
    outward[0] * 0.75 + tangentDirection[0] * variation,
    1,
    outward[2] * 0.75 + tangentDirection[2] * variation,
  ];
  const length = Math.hypot(...direction);
  direction.forEach((value, axis) => {
    direction[axis] = value / length;
  });
  const horizontal = Math.hypot(direction[0], direction[2]);
  const right = [direction[2] / horizontal, 0, -direction[0] / horizontal];
  const up = [
    -right[2] * direction[1],
    right[2] * direction[0] - right[0] * direction[2],
    right[0] * direction[1],
  ];
  const tangent = Math.tan(radians(45 / 2)),
    safeY = safeVerticalFraction(viewportHeight, hudRects);
  let distance = 3.2;
  for (const point of points) {
    const q = point.map((value, axis) => value - target[axis]);
    const depth = q.reduce(
      (sum, value, axis) => sum + value * direction[axis],
      0,
    );
    const x =
      Math.abs(q.reduce((sum, value, axis) => sum + value * right[axis], 0)) +
      0.23;
    const y =
      Math.abs(q.reduce((sum, value, axis) => sum + value * up[axis], 0)) +
      0.23;
    distance = Math.max(
      distance,
      depth +
        Math.max(
          x / (tangent * Math.max(0.2, aspect) * 0.92),
          y / (tangent * safeY),
        ),
    );
  }
  distance += 0.25 * (1 - smooth(sample.progress));
  return {
    ...metadata,
    phase: slot.kind === "group" ? "outcome-group" : "outcome-player",
    seat: slot.seat,
    position: target.map((value, axis) => value + direction[axis] * distance),
    target,
    fov: 49 - 4 * smooth(sample.progress),
    focusPoints: points,
  };
}

/** A fixed human perspective with a gentle lateral move and lens change. */
export function samplePlayerAreaCamera({
  player,
  slot,
  now,
  phase = "outcome-player",
  roundId = "idle",
  aspect = 16 / 9,
}) {
  const seat = slot?.seat ?? player?.seat ?? 0;
  const area = SEAT_LAYOUT[seat] || SEAT_LAYOUT[0];
  const startAt = slot?.startAt ?? now,
    endAt = slot?.endAt ?? startAt + IDLE_PLAYER_SHOT_MS;
  const progress = clamp((now - startAt) / Math.max(1, endAt - startAt), 0, 1),
    eased = smooth(progress);
  const variant =
    (hash(`${roundId}:${player?.id || slot?.playerId || seat}`) % 3) - 1;
  const idle = phase === "idle-player";
  const distance = (idle ? 3.0 : 3.25) - eased * 0.2;
  const lateral = variant * 0.65 + (eased - 0.5) * (idle ? 0.65 : 0.26);
  const targetY = idle ? 0.9 : 1.02;
  const target = [area.center[0], targetY, area.center[2]];
  const position = [
    area.center[0] + area.outward[0] * distance + area.tangent[0] * lateral,
    (idle ? 1.15 : 1.65) + Math.sin(progress * Math.PI) * 0.04,
    area.center[2] + area.outward[2] * distance + area.tangent[2] * lateral,
  ];
  const minimumFov = degrees(
    2 *
      Math.atan(
        0.8 /
          (Math.hypot(
            position[0] - target[0],
            position[1] - target[1],
            position[2] - target[2],
          ) *
            Math.min(1, Math.max(0.3, aspect))),
      ),
  );
  return {
    phase,
    position,
    target,
    fov: Math.max((idle ? 51 : 46) - eased * 5, minimumFov),
    playerId: player?.id || slot?.playerId,
    seat,
    progress,
    shotKey: `${phase}:${roundId}:${player?.id || slot?.playerId || seat}`,
    name: player?.name || slot?.name || "Player",
  };
}

// Includes the complete outer deck, dealer inventory, and the tallest visible
// player bank, rather than framing only the recessed felt.
export const BETTING_TABLE_BOUNDS = Object.freeze({
  min: Object.freeze([-7.35, 0, -3.65]),
  max: Object.freeze([7.35, 1.9, 4.65]),
});

export function fitBettingCamera({
  aspect = 16 / 9,
  top = 0.13,
  bottom = 0.88,
  horizontalLimit = 0.92,
  bounds = BETTING_TABLE_BOUNDS,
  minHeight = 10.8,
} = {}) {
  const fov = 43,
    tangent = Math.tan(radians(fov / 2));
  const pitch = 0.15,
    cosine = Math.cos(pitch),
    sine = Math.sin(pitch),
    targetY = 0.4;
  const upper = 1 - 2 * Math.min(0.45, top + 0.01);
  const lower = 1 - 2 * Math.max(0.55, bottom - 0.01);
  const coefficients = (edge) => ({
    a: (edge * tangent) / (cosine * (cosine - edge * tangent * sine)),
    b: (edge * tangent * cosine + sine) / (cosine - edge * tangent * sine),
  });
  const lo = coefficients(lower),
    hi = coefficients(upper);
  const corners = [];
  for (const x of [bounds.min[0], bounds.max[0]])
    for (const y of [bounds.min[1], bounds.max[1]])
      for (const z of [bounds.min[2], bounds.max[2]]) corners.push([x, y, z]);
  const lowerOffset = Math.max(
    ...corners.map(([, y, z]) => z - (y - targetY) * lo.b),
  );
  const upperOffset = Math.min(
    ...corners.map(([, y, z]) => z - (y - targetY) * hi.b),
  );
  const centerA = (lo.a + hi.a) / 2,
    centerOffset = (lowerOffset + upperOffset) / 2;
  const verticalHeight = (lowerOffset - upperOffset) / (hi.a - lo.a);
  const horizontalHeight = Math.max(
    ...corners.map(
      ([x, y, z]) =>
        (Math.abs(x) /
          (tangent * Math.max(0.2, aspect) * Math.max(0.3, horizontalLimit)) +
          (y - targetY) * cosine +
          z * sine -
          centerOffset * sine) /
        (1 / cosine + centerA * sine),
    ),
  );
  const height = Math.max(minHeight, verticalHeight, horizontalHeight) * 1.01;
  const targetZ = centerA * height + centerOffset;
  return {
    phase: "betting",
    position: [0, targetY + height, targetZ + height * Math.tan(pitch)],
    target: [0, targetY, targetZ],
    fov,
  };
}

/** Close to the live betting region; outer banks are visited by player shots. */
export function sampleBettingOverview({
  aspect = 16 / 9,
  viewportWidth = 0,
  viewportHeight = 0,
  hudRects = [],
} = {}) {
  let top = 0.1,
    bottom = 0.92;
  if (viewportHeight && hudRects.length) {
    top = 0;
    bottom = 1;
    for (const rect of hudRects) {
      if (rect.y + rect.height <= viewportHeight * 0.5)
        top = Math.max(top, (rect.y + rect.height) / viewportHeight);
      else if (rect.y >= viewportHeight * 0.5)
        bottom = Math.min(bottom, rect.y / viewportHeight);
    }
  }
  return fitBettingCamera({
    aspect,
    top,
    bottom,
    horizontalLimit: viewportWidth
      ? 1 - (100 * (viewportHeight / 1080)) / viewportWidth
      : 0.95,
    bounds: { min: [-4.65, 0, -1.85], max: [4.65, 0.45, 2.2] },
    minHeight: 6.8,
  });
}

/** Auto's resting views: wide lobby, brief optional breather, then betting bed. */
export function sampleTableCamera({
  state,
  now,
  aspect = 16 / 9,
  viewportWidth = 0,
  viewportHeight = 0,
  hudRects = [],
  reducedMotion = false,
}) {
  if (state?.status !== "playing")
    return {
      phase: "lobby",
      position: [8.4, 7.4, 17.6],
      target: [0, 0.4, 0.4],
      fov: 48,
    };
  const viewOptions = { aspect, viewportWidth, viewportHeight, hudRects };
  const overview = sampleBettingOverview(viewOptions);
  if (reducedMotion || state.rolling || state.aim?.active) return overview;
  const plan = outcomePresentation(state);
  const active = sampleOutcomeTour(plan, now, { deadline: state.nextRollAt });
  if (active)
    return sampleOutcomeCamera({
      state,
      plan,
      sample: active,
      now,
      ...viewOptions,
    });
  const resultEnd = state.throw
    ? (state.throw.settledAt ?? state.throw.startAt + state.throw.duration) +
      RESULT_CAMERA_HOLD_MS
    : 0;
  const origin = Math.max(
    state.bettingOpenedAt || state.createdAt || 0,
    Math.min(plan?.endAt || 0, state.nextRollAt ?? Infinity),
    resultEnd,
  );
  if (now < origin) return overview;
  const idlePlan = finiteIdleCameraPlan(state, plan, origin, now);
  const idleMetadata = {
    idleTourEndAt: idlePlan.endAt,
    idleShotCount: idlePlan.slots.length,
    idleTourKey: idlePlan.id,
  };
  const slot = idlePlan.slots.find(
    (slot) => now >= slot.startAt && now < slot.endAt,
  );
  if (!slot) return { ...overview, ...idleMetadata };
  const player = (state.players || []).find(
    (player) => player.id === slot.playerId,
  );
  if (!player || player.left) return { ...overview, ...idleMetadata };
  return {
    ...samplePlayerAreaCamera({
      player,
      phase: "idle-player",
      roundId: `${idlePlan.id}:${slot.index}`,
      slot,
      now,
      aspect,
    }),
    ...idleMetadata,
  };
}

const rigCache = new Map();
export function throwCameraRig(throwState) {
  const key = `${throwState.id}:${throwState.seed}`;
  if (rigCache.has(key)) return rigCache.get(key);
  let hash = Number.isInteger(throwState.seed)
    ? throwState.seed >>> 0
    : 2166136261;
  if (!Number.isInteger(throwState.seed))
    for (const char of String(throwState.id))
      hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
  hash = Math.imul(hash ^ (hash >>> 16), 0x45d9f3b) >>> 0;
  let selected = (hash ^ (hash >>> 16)) & 3;
  if (throwState.frames?.length) {
    let best = Infinity;
    for (let rig = 0; rig < THROW_CAMERA_RIGS.length; rig++) {
      const eye = THROW_CAMERA_RIGS[rig];
      let nearest = Infinity,
        largestAngle = 0,
        totalDistance = 0,
        count = 0;
      for (
        let i = 0;
        i < throwState.frames.length;
        i += Math.max(1, Math.floor(throwState.frames.length / 60))
      ) {
        const frame = throwState.frames[i];
        const a = [frame[1] - eye[0], frame[2] - eye[1], frame[3] - eye[2]],
          b = [frame[8] - eye[0], frame[9] - eye[1], frame[10] - eye[2]];
        const da = Math.hypot(...a),
          db = Math.hypot(...b);
        nearest = Math.min(nearest, da, db);
        totalDistance += da + db;
        count += 2;
        largestAngle = Math.max(
          largestAngle,
          Math.acos(
            clamp(
              a.reduce((sum, v, j) => sum + v * b[j], 0) / (da * db),
              -1,
              1,
            ),
          ),
        );
      }
      const score =
        largestAngle * 2 +
        Math.max(0, 1.2 - nearest) * 5 +
        (totalDistance / count) * 0.015;
      if (score < best) {
        best = score;
        selected = rig;
      }
    }
  }
  rigCache.set(key, selected);
  if (rigCache.size > 64) rigCache.delete(rigCache.keys().next().value);
  return selected;
}

/** Pure, clock-based camera direction, suitable for late joins and any FPS. */
export function sampleThrowCamera({
  throwState,
  pose,
  now,
  aspect = 1,
  reducedMotion = false,
  viewportWidth = 0,
  viewportHeight = 0,
  hudRects = [],
}) {
  if (reducedMotion || !throwState || !pose?.dice?.length) return null;
  const { startAt, duration } = throwState;
  const settledAt = throwState.settledAt ?? startAt + duration;
  if (now < startAt || now >= settledAt + RESULT_CAMERA_HOLD_MS) return null;
  const target = [0, 0, 0];
  for (const die of pose.dice)
    for (let axis = 0; axis < 3; axis++)
      target[axis] += die.position[axis] / pose.dice.length;
  const radius =
    Math.max(
      ...pose.dice.map(({ position }) =>
        Math.hypot(...position.map((value, axis) => value - target[axis])),
      ),
    ) + 0.32;
  const narrowAxis = Math.min(1, Math.max(0.1, aspect));
  const rig = throwCameraRig(throwState);
  if (now >= settledAt) {
    const fov = 36;
    // At nearly square viewports the invite card reaches over the middle of
    // the top edge, so leave more headroom than the wide/portrait layouts.
    let framePadding = aspect >= 0.75 && aspect <= 1.25 ? 1.9 : 1.45;
    if (viewportWidth > 0 && viewportHeight > 0 && hudRects.length) {
      // Use the actual TV layout, including its distance-readable larger HUD.
      // Reserve a central horizontal band so neither resting die sits behind
      // the invite, logo, or result banner at any display density.
      let top = 0,
        bottom = viewportHeight;
      for (const rect of hudRects) {
        if (rect.y + rect.height <= viewportHeight * 0.5)
          top = Math.max(top, rect.y + rect.height);
        else if (rect.y >= viewportHeight * 0.5)
          bottom = Math.min(bottom, rect.y);
      }
      const safeHalf = Math.max(
        0.2,
        Math.min(
          1 - (2 * top) / viewportHeight,
          (2 * bottom) / viewportHeight - 1,
        ),
      );
      framePadding = Math.max(framePadding, 1.05 / safeHalf);
    }
    const height = Math.max(
      3,
      // Keep the full dice inside the central image, clear of the bottom
      // result banner and the brand/invite panels at the top corners.
      (radius * framePadding) / (Math.tan(radians(fov / 2)) * narrowAxis),
    );
    return {
      phase: "result",
      rig,
      target,
      fov,
      // A tiny Z offset makes the top-down look direction unambiguous with
      // OrbitControls' world-up vector, while retaining readable upper faces.
      position: [target[0], target[1] + height, target[2] + 0.004],
    };
  }
  const progress = clamp(
    (now - startAt) / Math.max(1, settledAt - startAt),
    0,
    1,
  );
  const position = [...THROW_CAMERA_RIGS[rig]];
  position[1] += Math.sin(progress * Math.PI) * 0.01;
  const direction = target.map((value, axis) => value - position[axis]);
  const length = Math.hypot(...direction);
  direction.forEach((value, axis) => {
    direction[axis] = value / length;
  });
  const horizontal = Math.hypot(direction[0], direction[2]) || 1;
  const right = [-direction[2] / horizontal, 0, direction[0] / horizontal];
  const up = [
    right[1] * direction[2] - right[2] * direction[1],
    right[2] * direction[0] - right[0] * direction[2],
    right[0] * direction[1] - right[1] * direction[0],
  ];
  let halfTangent = 0;
  for (const die of pose.dice) {
    const vector = die.position.map((value, axis) => value - position[axis]);
    const depth = Math.max(
      0.08,
      vector.reduce((sum, value, axis) => sum + value * direction[axis], 0) -
        0.2,
    );
    const x =
      Math.abs(
        vector.reduce((sum, value, axis) => sum + value * right[axis], 0),
      ) + 0.2;
    const y =
      Math.abs(vector.reduce((sum, value, axis) => sum + value * up[axis], 0)) +
      0.2;
    halfTangent = Math.max(
      halfTangent,
      x / (depth * Math.max(0.2, aspect)),
      y / depth,
    );
  }
  return {
    phase: "throw",
    rig,
    target,
    position,
    fov: Math.max(
      54 - progress * 6,
      degrees(2 * Math.atan(halfTangent * 1.08)),
    ),
  };
}
