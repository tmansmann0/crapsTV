import { createBankChipInventory } from "./bank-chip-inventory.js";
import { CHIP_DENOMINATIONS } from "./chip-stack.js";
import { chipHash, chipStackPose } from "./chip-character.js";
import {
  visualChipAmount,
  bankRoute,
  routeKey,
  seatStackSlot,
  SEAT_LAYOUT,
} from "./chip-flow.js";
import { chipPileSpecs, wagerPileLayout } from "./wager-layout.js";

const endOf = (flow) =>
  Math.min(flow.startAt + flow.duration, flow.cutAt ?? Infinity);
const values = CHIP_DENOMINATIONS.map((d) => d.value).reverse();
/** Dealer payouts use practical handfuls instead of repainting a whole rack. */
export function payoutChipSpecs(amount, id) {
  const cap =
    amount >= 1000000
      ? 100000
      : amount >= 500000
        ? 50000
        : amount >= 50000
          ? 10000
          : 2500;
  const chips = [];
  let left = amount;
  for (const denomination of values.filter((d) => d <= cap))
    while (left >= denomination && chips.length < 200) {
      const chipId = `arrival:${id}:${chips.length}`;
      chips.push({ id: chipId, denomination, wear: chipHash(chipId) % 3 });
      left -= denomination;
    }
  return chips;
}

/** Translate a stable tray slot/level into the same tilted physical stack pose. */
export function bankPhysicalSpecs(snapshot, seat) {
  return snapshot.chips.map((chip) => {
    const center = seatStackSlot(seat, chip.slot);
    const pose = chipStackPose(
      `${snapshot.routeId}:slot:${chip.slot}`,
      chip.level,
      {
        diameter: 0.23,
        thicknessScale: 1.15,
      },
    );
    return {
      ...chip,
      playerId: snapshot.routeId,
      diameter: 0.23,
      thicknessScale: 1.15,
      position: pose.position.map((n, axis) => n + center[axis]),
      rotation: pose.rotation,
    };
  });
}

function wagerSourceSpecs(flow, state, wagerSources) {
  const amount = Math.max(
    0,
    Math.min(flow.amount, flow.sourceAmount ?? flow.amount),
  );
  if (amount < 100 || !flow.from.bet)
    return { chips: [], specs: [], exchange: null };
  const route = flow.from,
    wholeAmount = route.bet.amount ?? amount;
  const pile = wagerPileLayout(route, state, wholeAmount);
  const canonical = chipPileSpecs(wholeAmount, {
    diameter: pile.diameter,
    seed: route.bet.id,
  });
  const candidates = wagerSources?.get(routeKey(route));
  const actual =
    candidates?.length === canonical.length &&
    candidates.every(
      (chip, index) =>
        chip.denomination === canonical[index].denomination &&
        typeof chip.id === "string" &&
        chip.position?.length === 3,
    )
      ? candidates
      : null;
  const whole = actual || canonical;
  const requested = chipPileSpecs(amount, {
    diameter: pile.diameter,
    seed: route.bet.id,
  });
  const selected = new Set();
  let needsChange = false;
  const specs = requested.map((desired, index) => {
    // Full settlements lift exactly the original stack. Partial take-downs
    // preferentially remove matching top chips without changing those below.
    const originalIndex =
      amount === wholeAmount
        ? index
        : whole.findLastIndex(
            (chip, n) =>
              !selected.has(n) && chip.denomination === desired.denomination,
          );
    const source = originalIndex >= 0 ? whole[originalIndex] : desired;
    if (originalIndex >= 0) selected.add(originalIndex);
    else needsChange = true;
    const appearanceId =
      originalIndex >= 0
        ? `${routeKey(route)}:${originalIndex}`
        : `change:${flow.id}:${index}`;
    const physicalSource = actual && originalIndex >= 0;
    return {
      ...source,
      ...(physicalSource
        ? {}
        : { id: `stake:${flow.id}:${index}`, appearanceId }),
      position: physicalSource
        ? [...source.position]
        : source.position.map((value, axis) => value + pile.basePosition[axis]),
    };
  });
  const chips = specs.map(({ id, appearanceId, denomination, wear }) => ({
    id,
    appearanceId,
    denomination,
    wear,
  }));
  return {
    chips,
    specs,
    exchange: needsChange
      ? {
          kind: "make-change",
          amount,
          beforeAmount: wholeAmount,
          afterAmount: Math.max(0, wholeAmount - amount),
          removed: whole.map((chip, index) => ({
            ...chip,
            id: actual ? chip.id : `${routeKey(route)}:${index}`,
            position: actual
              ? [...chip.position]
              : chip.position.map(
                  (value, axis) => value + pile.basePosition[axis],
                ),
          })),
          outgoing: specs,
        }
      : null,
  };
}

function seedFlowPlan(flow, state, wagerSources) {
  if (flow.from.kind === "bank")
    return {
      chips: [],
      sourceSpecs: [],
      profitChipIds: [],
      sourceExchange: null,
    };
  const stake =
    flow.from.kind === "bet"
      ? wagerSourceSpecs(flow, state, wagerSources)
      : { chips: [], specs: [], exchange: null };
  const stakeAmount =
    flow.from.kind === "bet"
      ? Math.max(0, Math.min(flow.amount, flow.sourceAmount ?? flow.amount))
      : 0;
  // Returning $100 is still the black chip that was wagered. Only the house's
  // new profit is issued as practical payout denominations, never the stake.
  const profit = payoutChipSpecs(
    flow.amount - stakeAmount,
    `${flow.id}:profit`,
  );
  return {
    chips: [...stake.chips, ...profit],
    sourceSpecs: stake.specs,
    profitChipIds: profit.map((chip) => chip.id),
    sourceExchange: stake.exchange,
  };
}

function queuedWagerSources(plan, state, plans, wagerSources) {
  const key = routeKey(plan.flow.from);
  const amount = plan.flow.from.bet.amount ?? plan.flow.sourceAmount;
  const pile = wagerPileLayout(plan.flow.from, state, amount);
  const canonical = chipPileSpecs(amount, {
    diameter: pile.diameter,
    seed: plan.flow.from.bet.id,
  });
  const existing = wagerSources?.get(key) || [];
  if (
    existing.length === canonical.length &&
    existing.every(
      (chip, index) => chip.denomination === canonical[index].denomination,
    )
  )
    return wagerSources;
  const pool = new Map(existing.map((chip) => [chip.id, chip]));
  for (const id of plan.wagerDependencies || []) {
    const incoming = plans.get(id);
    if (!incoming) continue;
    // Root reserves exact flight targets. A coarse frame can skip the arrival
    // render, so fall back to the same bottom-to-top denomination ordering.
    const chips = incoming.targetSpecs.length
      ? [...incoming.targetSpecs].sort((a, b) => a.position[1] - b.position[1])
      : [...incoming.chips].reverse();
    for (const chip of chips) if (!pool.has(chip.id)) pool.set(chip.id, chip);
  }
  const available = [...pool.values()],
    candidates = [];
  for (const geometry of canonical) {
    const index = available.findIndex(
      (chip) => chip.denomination === geometry.denomination,
    );
    if (index < 0) {
      const knownValue = [...pool.values()].reduce(
        (sum, chip) => sum + chip.denomination,
        0,
      );
      const canonicalValue = canonical.reduce(
        (sum, chip) => sum + chip.denomination,
        0,
      );
      if (plan.wagerDependencies.length && knownValue >= canonicalValue)
        // A real receipt conversion needs the outgoing handful to clear and
        // its canonical replacements to finish their short gravity drop.
        plan.receiptExchangeDelay = 620;
      return wagerSources;
    }
    const chip = available.splice(index, 1)[0];
    candidates.push({
      ...geometry,
      ...chip,
      diameter: geometry.diameter,
      thicknessScale: geometry.thicknessScale,
      position: geometry.position.map(
        (value, axis) => value + pile.basePosition[axis],
      ),
      rotation: [...geometry.rotation],
    });
  }
  return new Map(wagerSources || []).set(key, candidates);
}
function dependsOnWager(plan, flowId, plans) {
  const pending = [...(plan.wagerDependencies || [])],
    seen = new Set();
  while (pending.length) {
    const id = pending.pop();
    if (id === flowId) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    pending.push(...(plans.get(id)?.wagerDependencies || []));
  }
  return false;
}

/** Render-only event book. Financial amounts and roll timing remain authoritative. */
export function createBankChipPresentation() {
  const inventory = createBankChipInventory();
  const plans = new Map();
  let room = null;
  function clear() {
    inventory.clear();
    plans.clear();
    room = null;
    lastKey = null;
    cached = null;
  }
  let lastKey = null,
    cached = null;
  function sync(
    state,
    flows,
    now,
    { baseline = false, seats = SEAT_LAYOUT, wagerSources = null } = {},
  ) {
    const nextRoom = `${state.code}:${state.createdAt}`;
    if (baseline || room !== nextRoom) {
      clear();
      room = nextRoom;
      inventory.resetRoom(nextRoom);
    }
    const players = state.players.filter((p) => !p.left);
    const keyOf = () =>
      JSON.stringify([
        nextRoom,
        state.config.startingBank,
        state.config.minBet,
        players.map((p) => [p.id, p.seat, p.bank]),
        flows.map((f) => [
          f.id,
          f.startAt,
          endOf(f),
          now >= f.startAt,
          now >= endOf(f),
        ]),
      ]);
    if (!baseline && lastKey === keyOf() && cached)
      return { ...cached, mutations: new Map() };
    const mutations = new Map();
    const note = (id, result) => {
      if (!mutations.has(id))
        mutations.set(id, { added: [], removed: [], exchanges: [], moved: [] });
      const row = mutations.get(id);
      for (const key of Object.keys(row)) row[key].push(...result[key]);
    };
    for (const player of players)
      if (!inventory.snapshot(player.id)) {
        // A first render can see an already-started outgoing transfer. Seed the
        // pre-flight value once, then remove those real chips at its start below.
        const started = flows
          .filter(
            (f) =>
              f.from.kind === "bank" &&
              f.playerId === player.id &&
              f.startAt <= now &&
              endOf(f) > now,
          )
          .reduce((sum, f) => sum + f.sourceAmount, 0);
        inventory.update(
          player.id,
          visualChipAmount(player.bank, bankRoute(player.id), flows, now) +
            started,
          {
            startingBank: state.config.startingBank,
            minBet: state.config.minBet,
          },
        );
      }
    for (const flow of flows)
      if (!plans.has(flow.id) && endOf(flow) > now) {
        const wagerDependencies =
          flow.from.kind === "bet" && flow.sourceAmount >= 100
            ? [...plans.values()]
                .filter(
                  (plan) =>
                    !plan.arrived &&
                    plan.flow.to.kind === "bet" &&
                    routeKey(plan.flow.to) === routeKey(flow.from),
                )
                .map((plan) => plan.flow.id)
            : [];
        plans.set(flow.id, {
          flow,
          ...seedFlowPlan(flow, state, wagerSources),
          started: false,
          arrived: false,
          targetSpecs: [],
          wagerDependencies,
        });
      }
    const refreshBetSource = (plan) => {
      if (plan.flow.from.kind !== "bet" || !(plan.flow.sourceAmount >= 100))
        return;
      const sources = queuedWagerSources(plan, state, plans, wagerSources);
      if (plan.wagerDependencies.length)
        plan.flow.startAt = Math.max(
          plan.flow.startAt,
          ...plan.wagerDependencies.map((id) =>
            plans.has(id)
              ? endOf(plans.get(id).flow) + (plan.receiptExchangeDelay || 20)
              : plan.flow.startAt,
          ),
        );
      Object.assign(plan, seedFlowPlan(plan.flow, state, sources));
    };
    for (const plan of plans.values())
      if (!plan.started && !plan.arrived) refreshBetSource(plan);
    // A new throw/reconnect can abandon an in-flight presentation. Credit its
    // already-authoritative incoming chips exactly once before reconciling the
    // bank, rather than minting replacements then resurrecting the old flight.
    const currentFlowIds = new Set(flows.map((flow) => flow.id));
    for (const plan of plans.values())
      if (!plan.arrived && !currentFlowIds.has(plan.flow.id)) {
        const player = players.find((p) => p.id === plan.flow.playerId);
        if (player && plan.flow.to.kind === "bank")
          note(
            player.id,
            inventory.deposit(player.id, plan.chips, {
              amount: plan.flow.amount,
              flowId: plan.flow.id,
            }),
          );
        plan.arrived = true;
        plan.retired = true;
      }
    const events = [...plans.values()]
      .flatMap((plan) => [
        { at: plan.flow.startAt, start: true, plan },
        { at: endOf(plan.flow), start: false, plan },
      ])
      .sort((a, b) => a.at - b.at || Number(b.start) - Number(a.start));
    for (const { start, plan } of events) {
      // A preceding event can defer this flow while another win is in flight.
      // Re-read its current schedule rather than using the stale sorted time.
      if ((start ? plan.flow.startAt : endOf(plan.flow)) > now) continue;
      const flow = plan.flow,
        player = players.find((p) => p.id === flow.playerId);
      if (!player) continue;
      if (start && !plan.started && !plan.arrived) {
        if (flow.from.kind === "bank") {
          const bank = inventory.snapshot(player.id);
          if (bank.amount < flow.sourceAmount) {
            // Credits may already be spendable while their winning chips are
            // still flying. Queue this visual spend behind that arrival.
            const incoming = [...plans.values()]
              .filter(
                (p) =>
                  !p.arrived &&
                  p.flow.to.kind === "bank" &&
                  p.flow.playerId === player.id &&
                  p !== plan &&
                  !dependsOnWager(p, plan.flow.id, plans),
              )
              .sort((a, b) => endOf(a.flow) - endOf(b.flow))[0];
            if (incoming) {
              flow.startAt = Math.max(now + 1, endOf(incoming.flow) + 20);
              continue;
            }
            note(player.id, inventory.update(player.id, flow.sourceAmount));
          }
          const before = inventory.snapshot(player.id);
          const result = inventory.spend(player.id, flow.sourceAmount, {
            flowId: flow.id,
          });
          note(player.id, result);
          plan.chips = result.outgoingChips;
          if (!plan.chips.length)
            plan.chips = payoutChipSpecs(flow.amount, flow.id);
          const seat = seats[player.seat ?? 0];
          const sources = new Map(
            bankPhysicalSpecs(before, seat).map((s) => [s.id, s]),
          );
          const changed = new Map(
            bankPhysicalSpecs(
              { routeId: player.id, chips: result.outgoingChips },
              seat,
            ).map((s) => [s.id, s]),
          );
          plan.sourceSpecs = plan.chips.map(
            (chip) => sources.get(chip.id) || changed.get(chip.id) || chip,
          );
        } else {
          refreshBetSource(plan);
          if (flow.startAt > now) continue;
        }
        plan.started = true;
      } else if (!start && !plan.arrived) {
        if (flow.to.kind === "bank")
          note(
            player.id,
            inventory.deposit(player.id, plan.chips, {
              amount: flow.amount,
              flowId: flow.id,
            }),
          );
        plan.arrived = true;
      }
    }
    // Keep queued identities ready even if a new throw/reconnect cancels them
    // before their start; retirement must credit the original physical chips.
    for (const plan of plans.values())
      if (!plan.started && !plan.arrived) refreshBetSource(plan);
    const banks = new Map();
    for (const player of players) {
      const target = visualChipAmount(
        player.bank,
        bankRoute(player.id),
        flows,
        now,
      );
      const current = inventory.snapshot(player.id);
      if (current.amount !== target)
        note(player.id, inventory.update(player.id, target));
      banks.set(player.id, inventory.snapshot(player.id));
    }
    // Reserve upcoming deposits in virtual sequence so simultaneous wins land
    // at distinct stack levels. Existing physical IDs/slots remain untouched.
    for (const player of players) {
      const incoming = [...plans.values()]
        .filter(
          (p) =>
            !p.arrived &&
            p.flow.to.kind === "bank" &&
            p.flow.playerId === player.id,
        )
        .sort((a, b) => endOf(a.flow) - endOf(b.flow));
      let total = banks.get(player.id).amount;
      const previews = inventory.previewSequence(
        incoming.map((plan) => ({
          routeId: player.id,
          amount: (total += plan.flow.amount),
          options: { incomingChips: plan.chips, flowId: plan.flow.id },
        })),
      );
      incoming.forEach((plan, index) => {
        const wanted = new Set(plan.chips.map((c) => c.id));
        const seat = seats[player.seat ?? 0];
        plan.targetSpecs = bankPhysicalSpecs(previews[index], seat).filter(
          (s) => wanted.has(s.id),
        );
      });
    }
    for (const [id, plan] of plans)
      if (plan.arrived && now > endOf(plan.flow) + 2000) plans.delete(id);
    lastKey = keyOf();
    cached = { banks, mutations, plans };
    return cached;
  }
  return { sync, clear, inventory, plans };
}
