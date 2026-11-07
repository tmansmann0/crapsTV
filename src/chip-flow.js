// Pure presentation planning. Money remains authoritative in game.js.
export const CHIP_FLIGHT_MS = 1150;
export const SEAT_LAYOUT = [
  ...[-4.5, -2.7, -0.9, 0.9, 2.7, 4.5].map((x) => ({
    center: [x, 0.675, 3.91],
    tangent: [1, 0, 0],
    outward: [0, 0, 1],
    label: [x, 0.745, 4.36],
  })),
  ...[-1.85, 0, 1.85].map((z) => ({
    center: [-6.59, 0.675, z],
    tangent: [0, 0, 1],
    outward: [-1, 0, 0],
    label: [-7.04, 0.745, z],
  })),
  ...[-1.85, 0, 1.85].map((z) => ({
    center: [6.59, 0.675, z],
    tangent: [0, 0, -1],
    outward: [1, 0, 0],
    label: [7.04, 0.745, z],
  })),
];
export function seatStackSlot(seat, index) {
  if (seat.slots?.[index]) return [...seat.slots[index]];
  const column = index % 5,
    row = Math.floor(index / 5);
  return seat.center.map(
    (v, axis) =>
      v +
      seat.tangent[axis] * ((column - 2) * 0.29) +
      seat.outward[axis] * (row ? 0.135 : -0.135),
  );
}

// Place the side seats outside the six front seats, and leave the printed
// PASS/DON'T PASS wording clear in the center of each long betting lane.
export function lineWagerX(seat = 0) {
  const order = [6, 7, 8, 0, 1, 2, 3, 4, 5, 9, 10, 11];
  const slot = Math.max(0, order.indexOf(seat));
  return slot < 6 ? -4.35 + slot * 0.66 : 1.05 + (slot - 6) * 0.66;
}
export const bankRoute = (playerId) => ({ kind: "bank", playerId });
const dealerRoute = { kind: "dealer" };
export function betRoute(playerId, bet, bets = []) {
  const parent = bets.find((b) => b.id === bet.parent);
  return {
    kind: "bet",
    playerId,
    bet: { ...bet, parentType: parent?.type || bet.parentType },
  };
}
export function routeKey(route) {
  return route.kind === "bet"
    ? `bet:${route.playerId}:${route.bet.id}:${route.bet.point || 0}:${route.bet.parentType || ""}`
    : `${route.kind}:${route.playerId || ""}`;
}

/** First snapshots, room resets, and reconnect baselines intentionally have no flights. */
export function planChipFlows(previous, next, { now = Date.now() } = {}) {
  if (
    !previous ||
    !next ||
    previous.code !== next.code ||
    previous.createdAt !== next.createdAt ||
    next.status !== "playing"
  )
    return [];
  const flows = [];
  const newRoll = next.lastRoll && next.lastRoll.id !== previous.lastRoll?.id;
  // Do not replay old settlement animations after a sleeping/reconnecting display.
  const roll = newRoll && now - next.lastRoll.at <= 5000 ? next.lastRoll : null;
  if (newRoll && !roll) return [];
  const transitionAt = Number.isFinite(next.snapshotAt) ? next.snapshotAt : now;
  for (const [index, player] of (next.players || []).entries()) {
    const old = previous.players?.find((p) => p.id === player.id);
    if (!old || old.left || player.left) continue;
    const oldBets = old.bets || [],
      bets = player.bets || [];
    const settled = new Map();
    let unknownSettlement = false;
    const offset = (player.seat ?? index) * 28;
    let serial = 0;
    const add = (
      kind,
      amount,
      from,
      to,
      at,
      sourceAmount = amount,
      identity = "",
    ) => {
      if (!(amount > 0)) return;
      flows.push({
        id: `${identity}:${at}:${amount}:${player.id}:${serial++}:${kind}`,
        kind,
        playerId: player.id,
        amount,
        sourceAmount,
        from,
        to,
        startAt: at + offset,
        duration: CHIP_FLIGHT_MS,
      });
    };
    // Even stale settlements must be excluded from the manual-removal diff.
    const event = newRoll
      ? next.lastRoll.events?.find((e) => e.playerId === player.id)
      : null;
    for (const outcome of event?.bets || []) {
      const before = oldBets.find((b) => b.id === outcome.betId);
      if (!before || !roll) {
        settled.set(outcome.betId, 0);
        unknownSettlement = true;
        continue;
      }
      // React/network batching can combine a settlement and a later raise or
      // take-down. Infer the rule's post-settlement stake before diffing again.
      const standingWin =
        outcome.result === "win" && /^(place|hard|big)-/.test(before.type);
      settled.set(outcome.betId, standingWin ? outcome.amount : 0);
      const from = betRoute(player.id, before, oldBets);
      if (outcome.result === "lose")
        add(
          "loss",
          outcome.amount,
          from,
          dealerRoute,
          roll.at + 90,
          outcome.amount,
          roll.id,
        );
      else if (outcome.result === "push")
        add(
          "return",
          outcome.amount,
          from,
          bankRoute(player.id),
          roll.at + 90,
          outcome.amount,
          roll.id,
        );
      else if (outcome.result === "win") {
        const profit = Math.max(0, outcome.delta);
        const returnedStake = standingWin ? 0 : outcome.amount;
        // A standing place/hardway retains its stake: only profit comes home.
        add(
          "win",
          profit + returnedStake,
          from,
          bankRoute(player.id),
          roll.at + 90,
          returnedStake,
          roll.id,
        );
      }
    }
    for (const bet of bets) {
      const before = oldBets.find((b) => b.id === bet.id);
      const to = betRoute(player.id, bet, bets);
      const baseline = settled.has(bet.id)
        ? settled.get(bet.id)
        : before?.amount || 0;
      const added = bet.amount - baseline;
      if (added > 0)
        add(
          "wager",
          added,
          bankRoute(player.id),
          to,
          transitionAt,
          added,
          bet.id,
        );
      if (added < 0)
        add(
          "return",
          -added,
          betRoute(player.id, before, oldBets),
          bankRoute(player.id),
          transitionAt,
          -added,
          bet.id,
        );
      if (
        before &&
        baseline > 0 &&
        routeKey(betRoute(player.id, before, oldBets)) !== routeKey(to)
      ) {
        add(
          "travel",
          Math.min(baseline, bet.amount),
          betRoute(player.id, before, oldBets),
          to,
          transitionAt,
          Math.min(baseline, bet.amount),
          bet.id,
        );
      }
    }
    for (const bet of oldBets)
      if (!bets.some((b) => b.id === bet.id)) {
        const amount = settled.has(bet.id) ? settled.get(bet.id) : bet.amount;
        add(
          "return",
          amount,
          betRoute(player.id, bet, oldBets),
          bankRoute(player.id),
          transitionAt,
          amount,
          bet.id,
        );
      }
    const mine = flows.filter((f) => f.playerId === player.id);
    const explained = mine.reduce(
      (sum, f) =>
        sum +
        (f.to.kind === "bank" ? f.amount : 0) -
        (f.from.kind === "bank" ? f.amount : 0),
      0,
    );
    const addedBank = player.bank - old.bank - explained;
    // Re-ups are new chips from the house. Stale settlement differences are snapshots, not deposits.
    if (!unknownSettlement && addedBank > 0)
      add(
        "reup",
        addedBank,
        dealerRoute,
        bankRoute(player.id),
        transitionAt,
        0,
        `bank-${player.bank}`,
      );
  }
  return flows;
}

export function sampleChipFlow(flow, now) {
  const progress = Math.max(
    0,
    Math.min(1, (now - flow.startAt) / flow.duration),
  );
  return {
    progress,
    active: now >= flow.startAt && progress < 1,
    done: progress >= 1,
  };
}
export function arcPosition(from, to, progress, height = 1.45) {
  const p = Math.max(0, Math.min(1, progress));
  const t = p * p * (3 - 2 * p);
  return from.map(
    (v, i) =>
      v + (to[i] - v) * t + (i === 1 ? Math.sin(Math.PI * p) * height : 0),
  );
}

/** Hold incoming chips out of stationary stacks until their visible arrival. */
export function visualChipAmount(amount, route, flows, now) {
  const key = routeKey(route);
  let visible = amount;
  for (const flow of flows) {
    if (now < flow.startAt + flow.duration && routeKey(flow.to) === key)
      visible -= flow.amount;
    if (now < flow.startAt && routeKey(flow.from) === key)
      visible += flow.sourceAmount;
  }
  return Math.max(0, visible);
}

/** Bounded, denomination-correct bank display; counts retain the real value. */
export function bankChipStacks(amount, { maxVisible = 24, perStack = 6 } = {}) {
  const denoms = [100000, 50000, 10000, 2500, 500, 100];
  const largest = denoms.find((d) => d <= amount / 8) || 100;
  let remainder = Math.max(0, Math.floor(amount)),
    allowance = maxVisible;
  const stacks = [],
    denominations = [];
  for (const denomination of denoms.filter((d) => d <= largest)) {
    const count = Math.floor(remainder / denomination);
    remainder -= count * denomination;
    if (count) denominations.push({ denomination, count });
  }
  for (const [index, { denomination, count }] of denominations.entries()) {
    // Split regular bankrolls into believable stacks; very large counts compress visually.
    // Reserve one visible chip for each smaller denomination rather than hiding change.
    const visible = Math.min(
      count,
      Math.max(1, allowance - (denominations.length - index - 1)),
    );
    let left = visible,
      shownBefore = 0;
    while (left > 0 && stacks.length < 10) {
      const shown = Math.min(left, perStack);
      stacks.push({
        denomination,
        visibleCount: shown,
        count:
          Math.floor((count * (shownBefore + shown)) / visible) -
          Math.floor((count * shownBefore) / visible),
        compressed: count > visible,
      });
      left -= shown;
      shownBefore += shown;
    }
    allowance -= visible;
  }
  return stacks;
}
