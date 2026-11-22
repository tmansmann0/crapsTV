import {
  SEAT_LAYOUT,
  DEALER_CHIP_POSITION,
  chipTransferPosition,
  betRoute,
  routeKey,
} from "./chip-flow.js";
import { chipPoseBounds, chipStackBounds } from "./chip-character.js";
import { createBankChipInventory } from "./bank-chip-inventory.js";
import { bankPhysicalSpecs } from "./bank-chip-presentation.js";
import { BOARD_BET_SHIFT_Z } from "./board-layout.js";
import { BOUNDS } from "./dice-physics.js";
import { wagerPlacementMap, wagerPileLayout } from "./wager-layout.js";
import {
  planOutcomeTour,
  sampleOutcomeTour,
  SETTLEMENT_FLIGHT_MS,
} from "./round-presentation.js";

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
export const IDLE_REVISIT_REST_MS = 45000;
export const IDLE_CHANGE_REST_MS = 30000;
const outcomePlanCache = new Map();
const idlePlanCache = new Map();

function makeIdleVisit(id, origin, players) {
  const slots = players.map((player, index) => ({
    playerId: player.id,
    seat: player.seat,
    name: player.name,
    startAt: origin + IDLE_OVERVIEW_MS + index * IDLE_PLAYER_SHOT_MS,
    endAt: origin + IDLE_OVERVIEW_MS + (index + 1) * IDLE_PLAYER_SHOT_MS,
    index,
  }));
  return { id, startAt: origin, endAt: slots.at(-1)?.endAt ?? origin, slots };
}

const idleVisitAt = (cached, now) =>
  cached.visit && now >= cached.visit.startAt ? cached.visit : cached.plan;

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
  return makeIdleVisit(id, origin, candidates.slice(0, count));
}

function finiteIdleCameraPlan(state, presentation, origin, now) {
  const key = `${state.code || "table"}:${state.createdAt || 0}:${state.lastRoll?.id || state.bettingOpenedAt || "open"}`;
  const players = (state.players || []).filter(
    (player) => !player.left && player.connected !== false,
  );
  const ids = players.map((player) => player.id);
  let cached = idlePlanCache.get(key);
  if (
    cached &&
    cached.players === state.players &&
    cached.snapshotAt === state.snapshotAt &&
    cached.connectedCount === players.length &&
    now < cached.checkAt
  )
    return idleVisitAt(cached, now);

  const settledIds = new Set(
    (state.lastRoll?.events || [])
      .filter((event) => event.bets?.length)
      .map((event) => event.playerId),
  );
  const active = players.some(
    (player) =>
      player.bets?.length ||
      player.betPreview?.amount ||
      settledIds.has(player.id),
  );
  const bets = new Map(
    players.map((player) => [
      player.id,
      (player.bets || [])
        .map((bet) => `${bet.id}:${bet.type}:${bet.amount}:${bet.on === false}`)
        .sort()
        .join("|"),
    ]),
  );
  if (!cached) {
    cached = {
      known: new Set(ids),
      consumed: active,
      plan: planFiniteIdleCamera(state, { presentation, origin }),
      changedAt: null,
      visit: null,
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
      cached.visit = null;
      cached.changedAt = null;
    } else if (!cached.consumed && active) {
      cached.plan = planFiniteIdleCamera(state, {
        presentation,
        origin: Math.max(origin, state.snapshotAt ?? now),
      });
      cached.consumed = true;
    } else if (
      players.some(
        (player) => cached.bets.get(player.id) !== bets.get(player.id),
      )
    ) {
      cached.changedAt ??= state.snapshotAt ?? now;
    }
  }
  cached.bets = bets;
  cached.players = state.players;
  cached.snapshotAt = state.snapshotAt;
  cached.connectedCount = players.length;

  const previous = cached.visit || cached.plan;
  const changed = cached.changedAt !== null;
  const repeatAt = Math.min(
    previous.endAt + IDLE_REVISIT_REST_MS,
    changed
      ? Math.max(previous.endAt + IDLE_CHANGE_REST_MS, cached.changedAt)
      : Infinity,
  );
  cached.checkAt = repeatAt;
  if (now < repeatAt) return idleVisitAt(cached, now);

  const candidates = players
    .filter(
      (player) =>
        player.bets?.some((bet) => bet.amount > 0) || settledIds.has(player.id),
    )
    .sort((a, b) => a.seat - b.seat || a.id.localeCompare(b.id));
  if (!candidates.length || (!changed && candidates.length === 1)) {
    cached.checkAt = Infinity;
    return previous;
  }
  const count = Math.min(candidates.length, IDLE_MAX_SHOTS);
  const cycleMs =
    IDLE_REVISIT_REST_MS + IDLE_OVERVIEW_MS + count * IDLE_PLAYER_SHOT_MS;
  const skipped = Math.floor((now - repeatAt) / cycleMs);
  const startAt = repeatAt + skipped * cycleMs;
  const lastId = previous.slots.at(-1)?.playerId;
  const offset =
    (candidates.findIndex((p) => p.id === lastId) + 1 + skipped * count) %
    candidates.length;
  const selected = Array.from(
    { length: count },
    (_, i) => candidates[(offset + i) % candidates.length],
  );
  cached.visit = makeIdleVisit(
    `idle-revisit:${key}:${startAt}`,
    startAt,
    selected,
  );
  cached.changedAt = null;
  cached.checkAt = cached.visit.endAt + IDLE_REVISIT_REST_MS;
  return cached.visit;
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

const corners = (min, max) =>
  [min[0], max[0]].flatMap((x) =>
    [min[1], max[1]].flatMap((y) => [min[2], max[2]].map((z) => [x, y, z])),
  );
const boundsOf = (points) => ({
  min: [0, 1, 2].map((axis) => Math.min(...points.map((p) => p[axis]))),
  max: [0, 1, 2].map((axis) => Math.max(...points.map((p) => p[axis]))),
});
const mix = (a, b, t) => a.map((value, axis) => value + (b[axis] - value) * t);

/** Move from the captured view to a new resting composition along a single eased path. */
export function sampleCameraSlide(from, to, progress) {
  if (progress <= 0) return from;
  if (progress >= 1) return to;
  const t = smooth(progress);
  const orbit = ({ position, target }) => {
    const [x, y, z] = position.map((value, axis) => value - target[axis]);
    return [
      Math.hypot(x, y, z),
      Math.atan2(x, z),
      Math.atan2(y, Math.hypot(x, z)),
    ];
  };
  const start = orbit(from);
  const end = orbit(to);
  const turn = end[1] - start[1];
  end[1] = start[1] + Math.atan2(Math.sin(turn), Math.cos(turn));
  const [distance, heading, pitch] = mix(start, end, t);
  const target = mix(from.target, to.target, t);
  const horizontal = Math.cos(pitch) * distance;
  return {
    position: [
      target[0] + horizontal * Math.sin(heading),
      target[1] + distance * Math.sin(pitch),
      target[2] + horizontal * Math.cos(heading),
    ],
    target,
    fov: from.fov + (to.fov - from.fov) * t,
  };
}

const estimatedBankLayouts = new Map();
const bankSubjectCache = new WeakMap();
function bankSubject(player, macro = false, state = null) {
  const area = SEAT_LAYOUT[player?.seat ?? 0] || SEAT_LAYOUT[0];
  let specs = state?.bankLayouts?.[player?.id];
  if (!specs) {
    // Headless callers and the very first opening frame use the same mixed
    // inventory policy as the renderer, not the old six-chip money tokens.
    const key = `${player?.id}:${player?.seat ?? 0}:${player?.bank ?? 100000}:${state?.config?.startingBank}:${state?.config?.minBet}`;
    specs = estimatedBankLayouts.get(key);
    if (!specs) {
      const inventory = createBankChipInventory();
      const snapshot = inventory.update(
        player?.id || "opening",
        player?.bank ?? 100000,
        {
          startingBank: state?.config?.startingBank,
          minBet: state?.config?.minBet,
        },
      );
      specs = bankPhysicalSpecs(snapshot, area);
      estimatedBankLayouts.set(key, specs);
      if (estimatedBankLayouts.size > 96)
        estimatedBankLayouts.delete(estimatedBankLayouts.keys().next().value);
    }
  }
  const allSpecs = specs;
  let cache = bankSubjectCache.get(allSpecs);
  if (!cache) {
    cache = {};
    bankSubjectCache.set(allSpecs, cache);
  }
  const cacheKey = macro ? "macro" : "rack";
  if (cache[cacheKey]) return cache[cacheKey];
  if (macro && specs.length) {
    const tallest = specs.reduce((best, spec) =>
      chipPoseBounds(spec).max[1] > chipPoseBounds(best).max[1] ? spec : best,
    );
    specs = specs.filter((spec) => spec.slot === tallest.slot);
  }
  const points = specs.flatMap((spec) => {
    const bounds = chipPoseBounds(spec);
    return corners(bounds.min, bounds.max);
  });
  if (!points.length)
    points.push(
      ...corners(
        [area.center[0] - 0.35, area.center[1], area.center[2] - 0.16],
        [area.center[0] + 0.35, area.center[1] + 0.08, area.center[2] + 0.16],
      ),
    );
  const bounds = boundsOf(points);
  return (cache[cacheKey] = {
    points,
    bounds,
    height: bounds.max[1] - bounds.min[1],
    kind: "bank",
    area,
  });
}
const emptyPlayers = [];
const wagerSubjects = new WeakMap();
function wagerSubject(route, state, plan = null) {
  const players = state.players || emptyPlayers;
  let record = wagerSubjects.get(players);
  if (record?.plan !== plan || record?.mode !== state.config.mode) {
    record = { plan, mode: state.config.mode, subjects: new Map() };
    wagerSubjects.set(players, record);
  }
  const id = routeKey(route);
  const key = `${id}:${route.bet.amount}`;
  const spec = state.wagerLayouts?.get(id);
  const cached = record.subjects.get(key);
  if (cached && (cached.spec === spec || (plan && cached.spec))) return cached;
  let bounds;
  if (spec?.length) bounds = chipStackBounds(spec);
  else {
    record.placements ??= wagerPlacementMap(
      state,
      plan?.transfers.map((flow) => flow.from),
    );
    bounds = wagerPileLayout(
      route,
      state,
      route.bet.amount || 500,
      record.placements.get(id),
    ).bounds;
  }
  const subject = {
    points: corners(bounds.min, bounds.max),
    height: bounds.max[1] - bounds.min[1],
    spec,
  };
  record.subjects.set(key, subject);
  return subject;
}

const dealerSubject = {
  height: 0.56,
  points: corners(
    [
      DEALER_CHIP_POSITION[0] - 1.08,
      DEALER_CHIP_POSITION[1] - 0.09,
      DEALER_CHIP_POSITION[2] - 0.36,
    ],
    [
      DEALER_CHIP_POSITION[0] + 1.08,
      DEALER_CHIP_POSITION[1] + 0.47,
      DEALER_CHIP_POSITION[2] + 0.21,
    ],
  ),
};
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
export const CHIP_CAMERA_VARIANTS = Object.freeze([
  "bank-macro",
  "bank-overhead",
  "bet-low-glide",
  "bet-overhead",
  "bank-sweep",
  "bet-cross-sweep",
]);

function insideCushion([x, , z]) {
  const { x: halfWidth, z: halfDepth, cornerRadius } = BOUNDS;
  return (
    Math.hypot(
      Math.max(0, Math.abs(x) - (halfWidth - cornerRadius)),
      Math.max(0, Math.abs(z) - (halfDepth - cornerRadius)),
    ) < cornerRadius - 0.12
  );
}

/** Fit the actual current chip bounds. Large stacks raise both eye and pitch. */
function fitChipCamera({
  points,
  height = 0,
  area,
  seed,
  progress = 0,
  aspect = 16 / 9,
  viewportHeight = 0,
  hudRects = [],
  variant = "bank-macro",
  transfer = false,
  traveling = false,
  aim = null,
  railClearance = 0,
}) {
  const bounds = boundsOf(points);
  const target =
    aim || bounds.min.map((value, axis) => (value + bounds.max[axis]) / 2);
  const overhead = variant.endsWith("overhead");
  const bet = variant.startsWith("bet-");
  const phase = traveling ? 0.5 : smooth(clamp(progress, 0, 1));
  const sign = seed % 2 ? 1 : -1;
  const motion =
    (phase - 0.5) * (variant.includes("sweep") ? 0.18 : 0.22) * sign;
  const yaw = ((seed % 7) - 3) * 0.22 + motion;
  const outward = area.outward;
  // A real lateral pass, not just another orbit. Refit the current subjects
  // against the translated aim point so close chips never slide behind HUD.
  const travel = variant.includes("sweep") ? 0.65 : overhead ? 0.4 : 0;
  const lateral = (phase - 0.5) * travel * sign;
  target[0] += outward[2] * lateral;
  target[2] -= outward[0] * lateral;
  // Looking from the inboard side keeps low bet closeups inside the cushion.
  const facing = bet ? -1 : 1;
  const base = [outward[0] * facing, 0, outward[2] * facing];
  let pitch = overhead ? 1.43 : bet ? 0.51 : 0.65;
  pitch += clamp(height - 0.09, 0, 0.45) * (overhead ? 0.13 : 1.45);
  pitch = Math.min(1.49, pitch);
  const horizontal = Math.cos(pitch);
  let direction = [
    (base[0] * Math.cos(yaw) + base[2] * Math.sin(yaw)) * horizontal,
    Math.sin(pitch),
    (base[2] * Math.cos(yaw) - base[0] * Math.sin(yaw)) * horizontal,
  ];
  const fov = overhead ? 38 - phase : 43 - phase * 2;
  const tangent = Math.tan(radians(fov / 2));
  const safeY = safeVerticalFraction(viewportHeight, hudRects);
  const fitDistance = (direction, minimum) => {
    const length = Math.hypot(direction[0], direction[2]);
    const right = [direction[2] / length, 0, -direction[0] / length];
    const up = [-right[2] * direction[1], -length, right[0] * direction[1]];
    let distance = minimum;
    for (const point of points) {
      const q = point.map((v, axis) => v - target[axis]);
      const depth = q.reduce((sum, v, axis) => sum + v * direction[axis], 0);
      const x =
        Math.abs(q.reduce((sum, v, axis) => sum + v * right[axis], 0)) + 0.07;
      const y =
        Math.abs(q.reduce((sum, v, axis) => sum + v * up[axis], 0)) + 0.08;
      distance = Math.max(
        distance,
        depth +
          Math.max(
            x / (tangent * Math.max(0.2, aspect) * 0.9),
            y / (tangent * safeY),
          ),
      );
    }
    return distance;
  };
  let minimum = traveling ? 2.1 : variant === "bank-macro" ? 0.96 : 1.18;
  const placeCamera = (direction) => {
    const distance = fitDistance(direction, minimum);
    return target.map((value, axis) => value + direction[axis] * distance);
  };
  let position = placeCamera(direction);
  // The camera may follow flying payouts across the rail. Clear its top rather
  // than looking through the cushion; source bet macros remain inside it.
  if (!bet || railClearance > 0) {
    const floor = 1.32 + height * 0.45;
    position[1] += Math.max(0, floor - position[1]) * (bet ? railClearance : 1);
    // Clearing the cushion changes the viewing angle. Refit along that new
    // direction so the old low-angle projection cannot clip a taller rack.
    const delta = position.map((value, axis) => value - target[axis]);
    const length = Math.hypot(...delta);
    direction = delta.map((value) => value / length);
    minimum = length;
    position = placeCamera(direction);
    pitch = Math.asin(direction[1]);
  }
  if (bet && insideCushion(target) && !insideCushion(position)) {
    // Low views can overshoot the rail when a subject is near the far edge.
    // Keep the shot's heading and aim, and refit at the shallowest pitch that
    // keeps both the lens and its path to the felt inside the cushion.
    const heading = Math.atan2(direction[0], direction[2]);
    const placeAtPitch = (angle) =>
      placeCamera([
        Math.sin(heading) * Math.cos(angle),
        Math.sin(angle),
        Math.cos(heading) * Math.cos(angle),
      ]);
    let low = pitch,
      high = Math.PI / 2 - 0.0001;
    position = placeAtPitch(high);
    for (let i = 0; i < 10; i++) {
      const angle = (low + high) / 2;
      const eye = placeAtPitch(angle);
      if (insideCushion(eye)) {
        high = angle;
        position = eye;
      } else low = angle;
    }
    pitch = high;
  }
  return {
    position,
    target,
    fov,
    focusPoints: points,
    subjectHeight: height,
    shotVariant: variant,
    pitch,
    subjectKind: transfer ? "transfer" : bet ? "bet" : "bank",
  };
}

/** Opening detail pass uses the same real stack fit as live player shots. */
export function sampleBankDetailCamera({
  player,
  state,
  progress = 0,
  aspect = 16 / 9,
}) {
  const subject = bankSubject(player, false, state);
  return fitChipCamera({
    ...subject,
    seed: hash(`opening:${player?.seat ?? 0}`),
    progress,
    aspect,
    variant: "bank-sweep",
  });
}

/** Prep holds the actual bet. The lens then follows the synchronized chips. */
export function sampleOutcomeCamera({
  state,
  plan,
  sample,
  now,
  aspect = 16 / 9,
  viewportHeight = 0,
  hudRects = [],
}) {
  const slot = sample.slot,
    memberIds = slot.playerIds || [slot.playerId];
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
    playerCount: memberIds.length,
    shotIndex: sample.index,
    shotCount: plan.slots.length,
    progress: sample.progress,
    transferProgress: sample.transferProgress,
    arrivalAt: slot.arrivalAt ?? slot.startAt,
    transferAt: slot.transferAt,
    preparing: now < slot.transferAt,
    shotKey: `outcome:${plan.rollId}:${sample.index}`,
  };
  const transfers = plan.transfers.filter((flow) =>
    memberIds.includes(flow.playerId),
  );
  const player =
    state.players?.find((p) => p.id === slot.playerId) ||
    state.players?.find((p) => memberIds.includes(p.id)) ||
    slot;
  if (!transfers.length)
    return {
      ...samplePlayerAreaCamera({
        player,
        state,
        slot,
        now,
        roundId: plan.rollId,
        aspect,
        viewportHeight,
        hudRects,
      }),
      ...metadata,
    };
  const seed = hash(`${plan.rollId}:${sample.index}:${memberIds.join(":")}`);
  let height = 0;
  const points = [],
    aims = [];
  const p = clamp(sample.transferProgress, 0, 1);
  const flightMs = slot.flightMs || SETTLEMENT_FLIGHT_MS;
  const [travel, lift] = chipTransferPosition(
    [0, 0, 0],
    [1, 0, 0],
    p * flightMs,
    0,
    flightMs,
  );
  for (const flow of transfers) {
    const subject =
      flow.kind === "win" && flow.sourceAmount === 0
        ? dealerSubject
        : wagerSubject(flow.from, state, plan);
    const receiver =
      flow.to.kind === "bank" &&
      state.players?.find((player) => player.id === flow.playerId);
    const rack =
      flow.to.kind === "bank"
        ? bankSubject(receiver || slot, false, state)
        : null;
    const endBounds = rack?.bounds;
    const destination = endBounds
      ? corners(endBounds.min, endBounds.max)
      : dealerSubject.points;
    const startBounds = boundsOf(subject.points);
    const start = mix(startBounds.min, startBounds.max, 0.5);
    // A deposit can shift the rack's occupied bounds during the tail. Keep
    // the track anchored to the tray instead of correcting back as it lands.
    const seat = rack?.area.center;
    const end = seat
      ? [seat[0], seat[1] + 0.13, seat[2]]
      : DEALER_CHIP_POSITION;
    aims.push(mix(start, end, travel));
    height = Math.max(
      height,
      subject.height +
        ((rack?.height ?? dealerSubject.height) - subject.height) * travel,
    );
    subject.points.forEach((point, index) => {
      const rest = mix(point, destination[index], travel);
      points.push([rest[0], rest[1] + lift, rest[2]]);
    });
  }
  // Advance to the receiving chips on a single path. Keep the arc inside the
  // frame without pitching up with it and then pulling the view back down.
  const aimed = boundsOf(aims);
  const aim = mix(aimed.min, aimed.max, 0.5);
  aim[1] += 0.32;
  const region = slot.focus?.region;
  const area = { ...(SEAT_LAYOUT[player?.seat ?? 0] || SEAT_LAYOUT[0]) };
  if (slot.kind === "group")
    area.outward =
      region === "left"
        ? [-1, 0, 0]
        : region === "right"
          ? [1, 0, 0]
          : [0, 0, 1];
  // A shared table-wide result gets an overhead; tightly related actors retain
  // the same close tracking language as an individual hero.
  const variant =
    slot.style === "overview" || memberIds.length > 3
      ? "bet-overhead"
      : ["bet-low-glide", "bet-cross-sweep", "bet-overhead"][seed % 3];
  const shot = fitChipCamera({
    points,
    height,
    area,
    seed,
    progress: p,
    aspect,
    viewportHeight,
    hudRects,
    variant,
    transfer: p > 0,
    traveling: true,
    aim,
    railClearance: smooth(clamp((p - 0.5) * 2, 0, 1)),
  });
  return {
    ...shot,
    ...metadata,
    phase: slot.kind === "group" ? "outcome-group" : "outcome-player",
    seat: slot.seat,
  };
}

/** Finite, varied visits: engraved bank faces and passes over current wagers. */
export function samplePlayerAreaCamera({
  player,
  state,
  slot,
  now,
  phase = "outcome-player",
  roundId = "idle",
  aspect = 16 / 9,
  viewportHeight = 0,
  hudRects = [],
}) {
  const seat = slot?.seat ?? player?.seat ?? 0;
  const area = SEAT_LAYOUT[seat] || SEAT_LAYOUT[0];
  const startAt = slot?.startAt ?? now,
    endAt = slot?.endAt ?? startAt + IDLE_PLAYER_SHOT_MS;
  const progress = clamp((now - startAt) / Math.max(1, endAt - startAt), 0, 1);
  const seed = hash(`${roundId}:${player?.id || slot?.playerId || seat}`);
  let variant = CHIP_CAMERA_VARIANTS[seed % CHIP_CAMERA_VARIANTS.length];
  const bets = (player?.bets || []).filter((bet) => bet.amount > 0);
  if (variant.startsWith("bet-") && (!state?.config || !bets.length))
    variant = ["bank-macro", "bank-overhead", "bank-sweep"][seed % 3];
  const subject = variant.startsWith("bet-")
    ? wagerSubject(betRoute(player.id, bets[seed % bets.length], bets), state)
    : bankSubject(player, variant === "bank-macro", state);
  const shot = fitChipCamera({
    ...subject,
    area,
    seed,
    progress,
    aspect,
    viewportHeight,
    hudRects,
    variant,
  });
  return {
    ...shot,
    phase,
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
    bounds: {
      min: [-4.65, 0, -1.85 + BOARD_BET_SHIFT_Z],
      max: [4.65, 0.45, 2.2 + BOARD_BET_SHIFT_Z],
    },
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
  if (!player || player.left || player.connected === false)
    return { ...overview, ...idleMetadata };
  return {
    ...samplePlayerAreaCamera({
      player,
      state,
      phase: "idle-player",
      roundId: `${idlePlan.id}:${slot.index}`,
      slot,
      now,
      ...viewOptions,
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
