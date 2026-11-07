// Shared visual timing only. The ledger has already settled before this runs.
export const SETTLEMENT_FLIGHT_MS = 1150;
export const SETTLEMENT_SLOT_MS = 1800;
export const SETTLEMENT_CAMERA_LEAD_MS = 450;
export const SETTLEMENT_RESULT_HOLD_MS = 1600;
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const freeze = (value) => {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
};
function actorsFor(state, sources = {}) {
  return (state.lastRoll?.events || [])
    .filter((event) => event.bets?.some((bet) => bet.amount > 0))
    .map((event) => {
      const player = state.players?.find(
        (player) => player.id === event.playerId,
      );
      const settlements = event.bets.filter((bet) => bet.amount > 0);
      const results = new Set(settlements.map((bet) => bet.result));
      return {
        playerId: event.playerId,
        seat: player?.seat ?? 99,
        name: event.name || player?.name || "Player",
        delta: event.delta || 0,
        outcome: results.size === 1 ? [...results][0] : "mixed",
        betLabels: settlements.map(
          (bet) => bet.label || bet.sourceBet?.type || "Bet",
        ),
        bets: settlements.map((bet) => ({
          ...bet,
          ...sources[`${event.playerId}:${bet.betId}`],
        })),
      };
    })
    .sort((a, b) => a.seat - b.seat || a.playerId.localeCompare(b.playerId));
}
const rollSeed = (id) =>
  [...String(id)].reduce(
    (hash, char) => Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0,
    2166136261,
  );
const regionFor = (actor) =>
  [0, 1, 2, 6, 7, 8].includes(actor.seat) ? "left" : "right";
const magnitude = (actor) =>
  actor.bets.reduce((sum, bet) => sum + Math.abs(bet.delta || 0), 0);
const exposure = (actor) =>
  actor.bets.reduce((sum, bet) => sum + Math.max(0, bet.amount || 0), 0);
const signature = (actor) =>
  actor.bets
    .map((bet) => `${bet.result}:${bet.sourceBet?.type || bet.label || "bet"}`)
    .sort()
    .join("|");
const distinctLabels = (actors) => [
  ...new Set(actors.flatMap((actor) => actor.betLabels)),
];
function equivalentGroups(actors) {
  const buckets = [];
  for (const actor of [...actors].sort(
    (a, b) =>
      (magnitude(a) || exposure(a)) - (magnitude(b) || exposure(b)) ||
      a.playerId.localeCompare(b.playerId),
  )) {
    const value = magnitude(actor) || exposure(actor),
      key = signature(actor);
    const bucket = buckets.find(
      (bucket) =>
        bucket.key === key &&
        value <= bucket.value * 1.25 &&
        value >= bucket.value * 0.8,
    );
    if (bucket) bucket.members.push(actor);
    else buckets.push({ key, value, members: [actor] });
  }
  return buckets
    .map((bucket) => bucket.members)
    .filter((members) => members.length >= 2)
    .sort(
      (a, b) =>
        (a.length <= 3 ? 0 : 1) - (b.length <= 3 ? 0 : 1) ||
        a.length - b.length ||
        magnitude(b[0]) - magnitude(a[0]),
    );
}
function editorialGroups(actors, capacity, seed, state) {
  const group = (members, reason = "overview") => ({
    members,
    reason,
    style:
      reason === "standout"
        ? "hero"
        : members.length === 1
          ? "individual"
          : members.length === 2 && reason === "shared-win"
            ? "pair"
            : reason === "overview"
              ? "overview"
              : "cluster",
  });
  if (actors.length <= 1)
    return actors.length ? [group(actors, "individual")] : [];
  if (capacity <= 1) return [group(actors)];
  const ranked = [...actors].sort(
    (a, b) =>
      magnitude(b) - magnitude(a) || a.playerId.localeCompare(b.playerId),
  );
  const bankBefore = (actor) =>
    Math.max(
      100,
      (state.players?.find((player) => player.id === actor.playerId)?.bank ??
        Infinity) - actor.delta,
    );
  const relative = (actor) => magnitude(actor) / bankBefore(actor);
  const returnRatio = (actor) =>
    magnitude(actor) / Math.max(1, exposure(actor));
  const salience = (actor) => {
    const others = ranked.filter((candidate) => candidate !== actor);
    const values = others.map(magnitude).sort((a, b) => a - b),
      median = values[Math.floor(values.length / 2)] || 0;
    const nextMagnitude = Math.max(1, ...others.map(magnitude));
    const raw =
      magnitude(actor) >= Math.max(1, median) * 2.2 &&
      magnitude(actor) >= nextMagnitude * 1.7;
    const bankroll =
      relative(actor) >= 0.35 &&
      relative(actor) >= Math.max(0.01, ...others.map(relative)) * 2 &&
      magnitude(actor) >= median * 0.25;
    const odds =
      returnRatio(actor) >= 5 &&
      returnRatio(actor) >= Math.max(1, ...others.map(returnRatio)) * 1.6 &&
      magnitude(actor) >= median * 0.5;
    if (!(magnitude(actor) > 0 && (raw || bankroll || odds))) return 0;
    return Math.max(
      raw ? magnitude(actor) / Math.max(1, median) : 0,
      bankroll ? relative(actor) * 4 : 0,
      odds ? returnRatio(actor) / 2 : 0,
    );
  };
  const hero = [...ranked].sort(
    (a, b) => salience(b) - salience(a) || magnitude(b) - magnitude(a),
  )[0];
  const standout = hero && salience(hero) > 0 ? hero : null;
  let desired = [];
  if (standout) {
    desired.push(group([standout], "standout"));
    let remaining = actors.filter((actor) => actor !== standout);
    const shared = equivalentGroups(remaining)[0];
    const groupSmallRemainder =
      remaining.length > 3 ||
      capacity < remaining.length + 1 ||
      (seed & 1) === 0;
    if (
      shared &&
      groupSmallRemainder &&
      (shared.length <= 3 || shared.length === remaining.length)
    ) {
      desired.push(
        group(
          shared,
          shared.every((actor) => actor.outcome === "win")
            ? "shared-win"
            : "shared-result",
        ),
      );
      const ids = new Set(shared.map((actor) => actor.playerId));
      remaining = remaining.filter((actor) => !ids.has(actor.playerId));
    }
    if (remaining.length <= 3)
      desired.push(
        ...[...remaining]
          .sort((a, b) => magnitude(b) - magnitude(a) || a.seat - b.seat)
          .map((actor) => group([actor], "individual")),
      );
    else if (remaining.length) desired.push(group(remaining));
  } else {
    const equivalent = equivalentGroups(actors);
    const regions = ["left", "right"]
      .map((region) => ({
        region,
        members: actors.filter((actor) => regionFor(actor) === region),
      }))
      .filter((entry) => entry.members.length);
    if (actors.length <= 3 && equivalent[0]?.length === actors.length)
      desired = [
        group(
          actors,
          actors.every((actor) => actor.outcome === "win")
            ? "shared-win"
            : "shared-result",
        ),
      ];
    else if (regions.length === 1) desired = [group(actors, regions[0].region)];
    else if (seed % 3 === 0) desired = [group(actors)];
    else if (seed % 3 === 1)
      desired = regions.map((entry) => group(entry.members, entry.region));
    else if (equivalent[0] && equivalent[0].length < actors.length) {
      const chosen = equivalent[0],
        ids = new Set(chosen.map((actor) => actor.playerId));
      desired = [
        group(
          chosen,
          chosen.every((actor) => actor.outcome === "win")
            ? "shared-win"
            : "shared-result",
        ),
        group(actors.filter((actor) => !ids.has(actor.playerId))),
      ];
    } else desired = [group(actors)];
  }
  if (desired.length > capacity) {
    const retained = desired.slice(0, capacity - 1),
      shown = new Set(
        retained.flatMap((entry) =>
          entry.members.map((actor) => actor.playerId),
        ),
      );
    desired = [
      ...retained,
      group(actors.filter((actor) => !shown.has(actor.playerId))),
    ];
  }
  return desired;
}
function transfersFor(roll, actors, slots, immediate) {
  const transfers = [];
  for (const actor of actors) {
    const slot = slots.find((slot) => slot.playerIds.includes(actor.playerId));
    for (const outcome of actor.bets) {
      if (!outcome.sourceBet) continue; // Old-host fallback can still direct its camera.
      const standing = outcome.standing === true;
      const returned =
        outcome.result === "win" && standing ? 0 : outcome.amount;
      const kind =
        outcome.result === "win"
          ? "win"
          : outcome.result === "lose"
            ? "loss"
            : "return";
      const amount =
        outcome.result === "win"
          ? Math.max(0, outcome.delta) + returned
          : outcome.amount;
      if (!(amount > 0)) continue;
      transfers.push({
        id: `settlement:${roll.id}:${actor.playerId}:${outcome.betId}:${kind}`,
        rollId: roll.id,
        kind,
        playerId: actor.playerId,
        betId: outcome.betId,
        amount,
        sourceAmount: returned,
        from: {
          kind: "bet",
          playerId: actor.playerId,
          bet: structuredClone(outcome.sourceBet),
        },
        to:
          kind === "loss"
            ? { kind: "dealer" }
            : { kind: "bank", playerId: actor.playerId },
        startAt: immediate ? roll.at + 90 + actor.seat * 28 : slot.transferAt,
        duration: immediate ? SETTLEMENT_FLIGHT_MS : slot.flightMs,
      });
    }
  }
  return transfers;
}
/**
 * Action-driven direction highlights standout results and related players,
 * grouping the remainder to keep the fixed window. Complete mode is available for explicit callers,
 * but the game uses fixed windows and never extends its next-roll deadline.
 */
export function planOutcomeTour(
  state,
  {
    startAt,
    slotMs = SETTLEMENT_SLOT_MS,
    leadMs = SETTLEMENT_CAMERA_LEAD_MS,
    tailMs = 150,
    mode = "fit-window",
    deadline = state.nextRollAt,
    sources = {},
  } = {},
) {
  if (
    !Number.isFinite(slotMs) ||
    slotMs <= 0 ||
    !Number.isFinite(leadMs) ||
    leadMs < 0 ||
    !Number.isFinite(tailMs) ||
    tailMs < 0
  )
    throw new RangeError("Invalid settlement timing.");
  if (!["fit-window", "complete"].includes(mode))
    throw new RangeError("Invalid settlement mode.");
  const roll = state.lastRoll;
  if (!roll || !Number.isFinite(roll.at)) return null;
  const actors = actorsFor(state, sources);
  const preferred = Number.isFinite(startAt)
    ? startAt
    : Math.max(
        roll.at + 250,
        (state.throw?.settledAt ?? roll.at - 300) + SETTLEMENT_RESULT_HOLD_MS,
      );
  const cutoff = Number.isFinite(deadline)
    ? Math.max(roll.at, deadline)
    : roll.at + 10000;
  const immediate = mode !== "complete" && cutoff <= roll.at;
  let begins = preferred;
  if (mode !== "complete" && cutoff - begins < SETTLEMENT_FLIGHT_MS)
    begins = Math.max(roll.at, cutoff - Math.min(slotMs, cutoff - roll.at));
  const available =
    mode === "complete" ? Infinity : Math.max(0, cutoff - begins);
  const slots = [];
  if (!immediate && actors.length && available > 0) {
    const capacity =
      mode === "complete"
        ? actors.length
        : Math.max(1, Math.floor(available / slotMs));
    const sequence = editorialGroups(
      actors,
      capacity,
      rollSeed(roll.id),
      state,
    );
    function add({ members, reason, style }) {
      const kind = members.length === 1 ? "player" : "group";
      const at = begins + slots.length * slotMs;
      const duration = Math.min(
        slotMs,
        mode === "complete" ? slotMs : cutoff - at,
      );
      // Arrive before the money moves. Short cooldowns compress the flight,
      // rather than silently consuming all of the camera's preparation time.
      const lead = Math.min(leadMs, duration * 0.35);
      const tail = Math.min(
        tailMs,
        Math.max(0, duration - lead - SETTLEMENT_FLIGHT_MS),
      );
      const flightMs = Math.min(
        SETTLEMENT_FLIGHT_MS,
        Math.max(1, duration - lead - tail),
      );
      const meta =
        kind === "player"
          ? members[0]
          : {
              playerId: null,
              seat: null,
              name: `${members.length} players`,
              delta: members.reduce((n, a) => n + a.delta, 0),
              outcome: members.every(
                (actor) => actor.outcome === members[0].outcome,
              )
                ? members[0].outcome
                : "mixed",
              betLabels: distinctLabels(members),
            };
      const { bets, ...publicMeta } = meta;
      slots.push({
        ...publicMeta,
        kind,
        reason,
        style,
        focus: {
          playerIds: members.map((actor) => actor.playerId),
          region: members.every(
            (actor) => regionFor(actor) === regionFor(members[0]),
          )
            ? regionFor(members[0])
            : "table",
          betLabels: distinctLabels(members),
        },
        playerIds: members.map((a) => a.playerId),
        members: members.map(({ bets, ...actor }) => actor),
        startAt: at,
        arrivalAt: at,
        prepareMs: lead,
        transferAt: at + lead,
        endAt: at + duration,
        flightMs,
      });
    }
    sequence.forEach(add);
  }
  const transfers = transfersFor(roll, actors, slots, immediate);
  return freeze({
    version: 1,
    rollId: roll.id,
    mode: immediate ? "immediate" : mode,
    startAt: slots[0]?.startAt ?? roll.at,
    endAt: slots.at(-1)?.endAt ?? roll.at,
    deadline: cutoff,
    slots,
    transfers,
  });
}
export function slotForPlayer(plan, playerId) {
  return plan?.slots?.find((slot) => slot.playerIds.includes(playerId)) || null;
}
export function sampleOutcomeTour(
  plan,
  now,
  { deadline = plan?.deadline } = {},
) {
  if (!plan || plan.mode === "immediate") return null;
  if (
    plan.mode === "fit-window" &&
    now >= Math.min(plan.deadline, deadline ?? Infinity)
  )
    return null;
  const index = plan.slots.findIndex(
    (slot) => now >= slot.startAt && now < slot.endAt,
  );
  if (index < 0) return null;
  const slot = plan.slots[index];
  return {
    slot,
    index,
    kind: slot.kind,
    progress: clamp((now - slot.startAt) / (slot.endAt - slot.startAt), 0, 1),
    transferProgress: clamp((now - slot.transferAt) / slot.flightMs, 0, 1),
    preparing: now < slot.transferAt,
  };
}
/** Current/future transfers are seekable after reconnect; completed ones stay done. */
export function remainingPresentationTransfers(state, now = Date.now()) {
  if (state?.rolling || state?.status !== "playing") return [];
  const plan = state?.lastRoll?.presentation;
  if (!plan || plan.version !== 1) return [];
  if (!Array.isArray(plan.transfers)) return [];
  const cutAt =
    plan.mode === "fit-window"
      ? Math.min(
          plan.deadline,
          Number.isFinite(state.nextRollAt) ? state.nextRollAt : Infinity,
        )
      : Infinity;
  return plan.transfers
    .filter(
      (flow) =>
        now < Math.min(flow.startAt + flow.duration, cutAt) &&
        flow.startAt < cutAt,
    )
    .map((flow) => ({
      ...flow,
      presentationMode: plan.mode,
      presentationDeadline: plan.deadline,
      ...(Number.isFinite(cutAt) ? { cutAt } : {}),
    }));
}
