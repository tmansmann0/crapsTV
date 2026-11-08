import test from "node:test";
import assert from "node:assert/strict";
import {
  createBankChipPresentation,
  bankPhysicalSpecs,
  payoutChipSpecs,
} from "../src/bank-chip-presentation.js";
import {
  planChipFlows,
  visualChipAmount,
  bankRoute,
  SEAT_LAYOUT,
  routeKey,
} from "../src/chip-flow.js";
import { chipPileSpecs, wagerPileLayout } from "../src/wager-layout.js";
import { createStartupShowcase } from "../src/startup-sequence.js";
import { chipPatinaParameters } from "../src/chip-character.js";

const value = (chips) => chips.reduce((n, c) => n + c.denomination, 0);
const ident = (c) => ({ id: c.id, denomination: c.denomination, wear: c.wear });
const state = (bank = 100000, changes = {}) => ({
  code: "ROOM",
  createdAt: 123,
  status: "playing",
  snapshotAt: 1000,
  config: { startingBank: 100000, minBet: 500 },
  players: [{ id: "p", seat: 0, bank, bets: [] }],
  ...changes,
});
const transfer = (
  id,
  amount,
  {
    from = "bet",
    to = "bank",
    startAt = 1100,
    duration = 1000,
    playerId = "p",
    sourceAmount = amount,
    ...other
  } = {},
) => ({
  id,
  amount,
  sourceAmount,
  playerId,
  kind: to === "bank" ? "win" : "wager",
  startAt,
  duration,
  from: {
    kind: from,
    playerId,
    bet: { id: `bet:${id}`, type: "pass", amount: sourceAmount },
  },
  to: { kind: to, playerId, bet: { id: `bet:${id}`, type: "pass", amount } },
  ...other,
});
function exact(result, s, flows, now) {
  for (const p of s.players.filter((p) => !p.left)) {
    const b = result.banks.get(p.id);
    assert.equal(
      b.amount,
      visualChipAmount(p.bank, bankRoute(p.id), flows, now),
    );
    assert.equal(value(b.chips) + b.reserveCents, b.amount);
    assert.equal(new Set(b.chips.map((c) => c.id)).size, b.chips.length);
    assert(b.stacks.every((x) => x.count <= 10));
  }
}
function assertRetained(before, after, removed = []) {
  const omitted = new Set(removed.map((c) => c.id));
  for (const chip of before.chips)
    if (!omitted.has(chip.id))
      assert.deepEqual(
        ident(after.chips.find((c) => c.id === chip.id)),
        ident(chip),
      );
}

test("a real wager transition spends the actual bank chip and preserves the mixed rack at $800→795", () => {
  const p = createBankChipPresentation(),
    old = state(80000),
    a = p.sync(old, [], 1000).banks.get("p");
  const next = state(79500, {
    snapshotAt: 1100,
    players: [
      {
        id: "p",
        seat: 0,
        bank: 79500,
        bets: [{ id: "b", type: "pass", amount: 500 }],
      },
    ],
  });
  const flows = planChipFlows(old, next, { now: 1100 });
  assert.equal(flows.length, 1);
  const result = p.sync(next, flows, 1100),
    plan = result.plans.get(flows[0].id),
    b = result.banks.get("p");
  exact(result, next, flows, 1100);
  assert.equal(plan.chips.length, 1);
  assert.equal(plan.chips[0].denomination, 500);
  assert(a.chips.some((c) => c.id === plan.chips[0].id));
  assertRetained(a, b, plan.chips);
  assert.equal(plan.sourceSpecs.length, 1);
  assert.deepEqual(
    plan.sourceSpecs[0].position,
    bankPhysicalSpecs(a, SEAT_LAYOUT[0]).find((c) => c.id === plan.chips[0].id)
      .position,
  );
  assert(!b.chips.some((c) => c.id === plan.chips[0].id));
  assert.deepEqual(p.sync(next, flows, 1500).banks.get("p").chips, b.chips);
});

test("a payout reserves real arrival identities and positions, holds them out of the bank, then stacks them exactly there", () => {
  const p = createBankChipPresentation(),
    old = state(),
    a = p.sync(old, [], 1000).banks.get("p");
  const next = state(102500),
    flows = [transfer("win", 2500)];
  const active = p.sync(next, flows, 1100),
    plan = active.plans.get("win");
  exact(active, next, flows, 1100);
  assert.equal(active.banks.get("p").amount, 100000);
  assert.deepEqual(active.banks.get("p").chips, a.chips);
  assert.equal(value(plan.chips), 2500);
  assert.equal(plan.targetSpecs.length, 1);
  const targets = structuredClone(plan.targetSpecs);
  const done = p.sync(next, flows, 2100);
  exact(done, next, flows, 2100);
  assertRetained(a, done.banks.get("p"));
  assert.equal(done.mutations.get("p").added.length, 1);
  const physical = bankPhysicalSpecs(done.banks.get("p"), SEAT_LAYOUT[0]);
  for (const t of targets)
    assert.deepEqual(
      physical.find((c) => c.id === t.id),
      t,
    );
  assert.equal(p.sync(next, flows, 2200).mutations.size, 0);
});

test("overlapping same-denomination payouts reserve distinct future levels and retain them through staggered arrivals", () => {
  const p = createBankChipPresentation();
  p.sync(state(), [], 1000);
  const next = state(105000),
    flows = [transfer("a", 2500), transfer("b", 2500, { startAt: 1150 })];
  const first = p.sync(next, flows, 1150),
    a = structuredClone(first.plans.get("a").targetSpecs),
    b = structuredClone(first.plans.get("b").targetSpecs);
  assert.equal(a.length, 1);
  assert.equal(b.length, 1);
  assert.notEqual(a[0].id, b[0].id);
  assert.notDeepEqual([a[0].slot, a[0].level], [b[0].slot, b[0].level]);
  const halfway = p.sync(next, flows, 2100);
  exact(halfway, next, flows, 2100);
  assert.deepEqual(halfway.plans.get("b").targetSpecs, b);
  const done = p.sync(next, flows, 2150);
  exact(done, next, flows, 2150);
  const actual = bankPhysicalSpecs(done.banks.get("p"), SEAT_LAYOUT[0]);
  for (const target of [...a, ...b])
    assert.deepEqual(
      actual.find((c) => c.id === target.id),
      target,
    );
});

test("concurrent outgoing wagers remove distinct physical chip IDs and cannot spend one chip twice", () => {
  const p = createBankChipPresentation(),
    before = p.sync(state(), [], 1000).banks.get("p");
  const next = state(99000),
    flows = [
      transfer("spend-a", 500, { from: "bank", to: "bet" }),
      transfer("spend-b", 500, { from: "bank", to: "bet" }),
    ];
  const r = p.sync(next, flows, 1100);
  exact(r, next, flows, 1100);
  const sent = flows.flatMap((f) => r.plans.get(f.id).chips);
  assert.equal(value(sent), 1000);
  assert.equal(new Set(sent.map((c) => c.id)).size, 2);
  assertRetained(before, r.banks.get("p"), sent);
});

test("connecting during an outgoing flight seeds the pre-flight bank once and spends it once", () => {
  const p = createBankChipPresentation(),
    next = state(99500),
    flows = [transfer("existing", 500, { from: "bank", to: "bet" })];
  const r = p.sync(next, flows, 1500);
  exact(r, next, flows, 1500);
  assert.equal(value(r.plans.get("existing").chips), 500);
  const before = r.banks.get("p");
  const done = p.sync(next, flows, 2200);
  exact(done, next, flows, 2200);
  assert.deepEqual(done.banks.get("p").chips, before.chips);
});

test("fractional banks and payouts remain exact without rendering fictional sub-dollar chips", () => {
  const p = createBankChipPresentation(),
    a = state(100050);
  p.sync(a, [], 1000);
  const next = state(100225),
    flows = [transfer("fraction", 175)];
  const active = p.sync(next, flows, 1100);
  exact(active, next, flows, 1100);
  assert.equal(value(active.plans.get("fraction").chips), 100);
  const done = p.sync(next, flows, 2100);
  exact(done, next, flows, 2100);
  assert.equal(done.banks.get("p").reserveCents, 125);
  assert(done.banks.get("p").chips.every((c) => c.denomination >= 100));
});

test("players have independent physical inventories and a new room discards every old reservation", () => {
  const p = createBankChipPresentation(),
    s = state(100000, {
      players: [
        { id: "p", seat: 0, bank: 100000, bets: [] },
        { id: "q", seat: 3, bank: 80000, bets: [] },
      ],
    });
  const a = p.sync(s, [], 1000),
    q = a.banks.get("q");
  const next = {
      ...s,
      players: [{ ...s.players[0], bank: 102500 }, s.players[1]],
    },
    flows = [transfer("pending", 2500)];
  const b = p.sync(next, flows, 1100);
  assert.deepEqual(b.banks.get("q").chips, q.chips);
  const oldIds = new Set(
    [...a.banks.values()].flatMap((b) => b.chips.map((c) => c.id)),
  );
  const fresh = p.sync({ ...s, createdAt: 124 }, [], 1200);
  assert.equal(fresh.plans.size, 0);
  assert(
    [...fresh.banks.values()]
      .flatMap((b) => b.chips)
      .every((c) => !oldIds.has(c.id)),
  );
});

test("payout handfuls use real denomination values with stable wear, bounded work and an explicit fractional remainder", () => {
  for (const amount of [50, 175, 2500, 100000, 100000000]) {
    const chips = payoutChipSpecs(amount, "fixed");
    assert(chips.length <= 200);
    assert(value(chips) <= amount);
    assert.deepEqual(chips, payoutChipSpecs(amount, "fixed"));
    assert(
      chips.every(
        (c) => Number.isInteger(c.wear) && c.wear >= 0 && c.wear <= 2,
      ),
    );
  }
});

test("discarding a presentation materializes its incoming IDs once and never deposits them again on a later bank change", () => {
  const p = createBankChipPresentation();
  p.sync(state(), [], 1000);
  const s = state(100500),
    flows = [transfer("cancelled", 500)];
  const active = p.sync(s, flows, 1500),
    arriving = active.plans.get("cancelled").chips.map(ident);
  const retired = p.sync(s, [], 1600);
  exact(retired, s, [], 1600);
  for (const chip of arriving)
    assert.deepEqual(
      ident(retired.banks.get("p").chips.find((c) => c.id === chip.id)),
      chip,
    );
  const retained = retired.banks.get("p").chips;
  const later = p.sync(state(100600), [], 2300);
  exact(later, state(100600), [], 2300);
  assertRetained({ chips: retained }, later.banks.get("p"));
  assert.equal(later.mutations.get("p").removed.length, 0);
  assert.equal(value(later.mutations.get("p").added), 100);
});

test("a deadline cutting off a future payout materializes planned IDs without waiting for its scheduled start", () => {
  const p = createBankChipPresentation();
  p.sync(state(), [], 1000);
  const s = state(100500),
    flows = [transfer("future", 500, { startAt: 3000 })];
  const pending = p.sync(s, flows, 1100),
    chips = pending.plans.get("future").chips.map(ident);
  flows[0].cutAt = 1500;
  const cut = p.sync(s, flows, 1500);
  exact(cut, s, flows, 1500);
  for (const chip of chips)
    assert.deepEqual(
      ident(cut.banks.get("p").chips.find((c) => c.id === chip.id)),
      chip,
    );
  assert.equal(cut.plans.get("future").arrived, true);
  const later = p.sync(s, flows, 3100);
  exact(later, s, flows, 3100);
  assert.equal(later.mutations.size, 0);
});

test("spending an already-authoritative but still-flying win queues the visual spend after arrival exactly once", () => {
  const p = createBankChipPresentation();
  p.sync(state(0), [], 1000);
  const flows = [
    transfer("credit", 1000),
    transfer("spend-credit", 500, { from: "bank", to: "bet" }),
  ];
  const s = state(500);
  const waiting = p.sync(s, flows, 1100);
  exact(waiting, s, flows, 1100);
  const spend = waiting.plans.get("spend-credit");
  assert.equal(spend.started, false);
  assert(spend.flow.startAt > 2100);
  const credit = p.sync(s, flows, 2100);
  exact(credit, s, flows, 2100);
  assert.equal(credit.banks.get("p").amount, 1000);
  assert.equal(spend.arrived, false);
  const started = p.sync(s, flows, 2120);
  exact(started, s, flows, 2120);
  assert.equal(spend.started, true);
  assert.equal(value(spend.chips), 500);
  assert.equal(started.banks.get("p").amount, 500);
  const done = p.sync(s, flows, 3120);
  exact(done, s, flows, 3120);
  assert.equal(spend.arrived, true);
});

test("a spend requiring dealer change retains a physical source pose for every outgoing chip", () => {
  const p = createBankChipPresentation();
  p.sync(
    state(10000, { config: { startingBank: 10000, minBet: 10000 } }),
    [],
    1000,
  );
  // Explicitly seed a single note to exercise a real denomination exchange.
  p.inventory.update("p", 0);
  p.inventory.deposit("p", [
    { id: "only-black", denomination: 10000, wear: 0 },
  ]);
  const flows = [transfer("change-spend", 100, { from: "bank", to: "bet" })],
    s = state(9900);
  const r = p.sync(s, flows, 1100);
  exact(r, s, flows, 1100);
  const plan = r.plans.get("change-spend");
  assert.equal(value(plan.chips), 100);
  assert(
    plan.sourceSpecs.every(
      (c) => c.position?.length === 3 && c.rotation?.length === 3,
    ),
  );
  assert(r.mutations.get("p").exchanges.some((e) => e.kind === "make-change"));
});

test("a coarse frame cannot complete a visually deferred spend using its previous end timestamp", () => {
  const p = createBankChipPresentation();
  p.sync(state(0), [], 1000);
  const flows = [
      transfer("late-credit", 1000),
      transfer("late-spend", 500, { from: "bank", to: "bet" }),
    ],
    s = state(500);
  p.sync(s, flows, 1099);
  const r = p.sync(s, flows, 2200);
  exact(r, s, flows, 2200);
  const plan = r.plans.get("late-spend");
  assert.equal(plan.started, false);
  assert.equal(plan.arrived, false);
  assert.equal(r.banks.get("p").amount, 1000);
  const started = p.sync(s, flows, 2201);
  exact(started, s, flows, 2201);
  assert.equal(plan.started, true);
  assert.equal(value(plan.chips), 500);
});

test("real closed wins, standing wins, losses and pushes conserve the authoritative bank and their planned arrivals", () => {
  for (const [type, stake, result, delta, endingBank, remains, amount] of [
    ["pass", 500, "win", 500, 100500, false, 1000],
    ["place-6", 600, "win", 700, 100100, true, 700],
    ["pass", 500, "lose", -500, 99500, false, 0],
    ["pass", 500, "push", 0, 100000, false, 500],
  ]) {
    const p = createBankChipPresentation(),
      bet = { id: "actual", type, amount: stake };
    const old = state(100000 - stake, {
      nextRollAt: 0,
      players: [{ id: "p", seat: 0, bank: 100000 - stake, bets: [bet] }],
    });
    p.sync(old, [], 1000);
    const next = state(endingBank, {
      nextRollAt: 0,
      lastRoll: {
        id: `roll:${type}:${result}`,
        at: 1100,
        events: [
          {
            playerId: "p",
            bets: [{ betId: "actual", amount: stake, result, delta }],
          },
        ],
      },
      players: [
        { id: "p", seat: 0, bank: endingBank, bets: remains ? [bet] : [] },
      ],
    });
    const flows = planChipFlows(old, next, { now: 1100 });
    assert.equal(
      flows
        .filter((f) => f.to.kind === "bank")
        .reduce((n, f) => n + f.amount, 0),
      amount,
    );
    const start = p.sync(next, flows, 1200);
    exact(start, next, flows, 1200);
    const expected = flows
      .filter((f) => f.to.kind === "bank")
      .flatMap((f) => start.plans.get(f.id).chips.map(ident));
    const end = Math.max(...flows.map((f) => f.startAt + f.duration));
    const finish = p.sync(next, flows, end);
    exact(finish, next, flows, end);
    assert.equal(finish.banks.get("p").amount, endingBank);
    for (const chip of expected)
      assert.deepEqual(
        ident(finish.banks.get("p").chips.find((c) => c.id === chip.id)),
        chip,
      );
  }
});

test("a closed $100 win returns its original black stake and mints only four green profit chips", () => {
  const presentation = createBankChipPresentation();
  const bet = { id: "black-pass", type: "pass", amount: 10000 };
  const old = state(90000, {
    nextRollAt: 0,
    players: [{ id: "p", seat: 0, bank: 90000, bets: [bet] }],
  });
  presentation.sync(old, [], 1000);
  const next = state(110000, {
    nextRollAt: 0,
    lastRoll: {
      id: "black-wins",
      at: 1100,
      events: [
        {
          playerId: "p",
          bets: [{ betId: bet.id, amount: 10000, result: "win", delta: 10000 }],
        },
      ],
    },
  });
  const flows = planChipFlows(old, next, { now: 1100 });
  const active = presentation.sync(next, flows, 1200),
    plan = active.plans.get(flows[0].id);
  assert.deepEqual(
    plan.chips.map((chip) => chip.denomination),
    [10000, 2500, 2500, 2500, 2500],
  );
  assert.equal(plan.profitChipIds.length, 4);
  assert.equal(plan.sourceSpecs.length, 1);
  const source = plan.sourceSpecs[0],
    layout = wagerPileLayout(plan.flow.from, next, 10000);
  const canonical = chipPileSpecs(10000, {
    diameter: layout.diameter,
    seed: bet.id,
  })[0];
  assert.equal(source.wear, canonical.wear);
  assert.equal(source.appearanceId, `${routeKey(plan.flow.from)}:0`);
  assert.deepEqual(
    chipPatinaParameters(source),
    chipPatinaParameters({ ...canonical, id: source.appearanceId }),
    "The wager's patina coordinates survive its flow-specific identity",
  );
  assert.deepEqual(source.rotation, canonical.rotation);
  assert.deepEqual(
    source.position,
    canonical.position.map((value, axis) => value + layout.basePosition[axis]),
  );
  assert.equal(source.diameter, layout.diameter);
  assert.equal(source.thicknessScale, 1.3);
  assert.equal(plan.sourceExchange, null);
  const done = presentation.sync(
    next,
    flows,
    flows[0].startAt + flows[0].duration,
  );
  exact(done, next, flows, flows[0].startAt + flows[0].duration);
  const landed = done.banks
    .get("p")
    .chips.filter((chip) => plan.chips.some((flying) => flying.id === chip.id));
  assert.deepEqual(landed.map(ident), plan.chips.map(ident));
  const returned = landed.find((chip) => chip.id === source.id);
  assert.equal(returned.appearanceId, source.appearanceId);
  assert.deepEqual(
    chipPatinaParameters(returned),
    chipPatinaParameters(source),
  );
});

test("wager source bookkeeping returns the actual spent bank chip ID, wear and patina unchanged", () => {
  const presentation = createBankChipPresentation();
  const initial = state(10000, {
    config: { startingBank: 10000, minBet: 500 },
  });
  presentation.sync(initial, [], 1000);
  // An explicit physical bank fixture: after spending it, the wager's model
  // carries this identity rather than a replacement generated from its value.
  const physical = {
    id: "persistent-bank-black",
    appearanceId: "original-handling-patina",
    denomination: 10000,
    wear: 2,
  };
  presentation.inventory.update("p", 0);
  presentation.inventory.deposit("p", [physical]);
  const bet = { id: "physical-black-pass", type: "pass", amount: 10000 };
  const wager = state(0, {
    snapshotAt: 1100,
    config: initial.config,
    players: [{ id: "p", seat: 0, bank: 0, bets: [bet] }],
  });
  const spending = planChipFlows(initial, wager, { now: 1100 });
  const sent = presentation
    .sync(wager, spending, 1100)
    .plans.get(spending[0].id).chips;
  assert.deepEqual(sent.map(ident), [ident(physical)]);
  presentation.sync(
    wager,
    spending,
    spending[0].startAt + spending[0].duration,
  );
  assert(
    !presentation.inventory
      .snapshot("p")
      .chips.some((chip) => chip.id === physical.id),
  );

  const next = state(20000, {
    config: initial.config,
    nextRollAt: 0,
    lastRoll: {
      id: "physical-black-wins",
      at: 3100,
      events: [
        {
          playerId: "p",
          bets: [{ betId: bet.id, amount: 10000, result: "win", delta: 10000 }],
        },
      ],
    },
  });
  const flows = planChipFlows(wager, next, { now: 3100 }),
    flow = flows[0];
  const layout = wagerPileLayout(flow.from, next, 10000);
  const canonical = chipPileSpecs(10000, {
    diameter: layout.diameter,
    seed: bet.id,
  })[0];
  const actual = {
    ...canonical,
    ...physical,
    position: canonical.position.map(
      (value, axis) => value + layout.basePosition[axis],
    ),
  };
  const wagerSources = new Map([[routeKey(flow.from), [actual]]]),
    untouched = structuredClone(actual);
  const active = presentation.sync(next, flows, 3200, { wagerSources }),
    plan = active.plans.get(flow.id);
  assert.deepEqual(plan.sourceSpecs, [actual]);
  assert.equal(plan.chips[0].id, physical.id);
  assert.equal(plan.chips[0].appearanceId, physical.appearanceId);
  assert.equal(plan.chips[0].wear, physical.wear);
  assert.deepEqual(
    chipPatinaParameters(plan.chips[0]),
    chipPatinaParameters(physical),
  );
  assert.deepEqual(wagerSources.get(routeKey(flow.from)), [untouched]);
  const end = flow.startAt + flow.duration;
  const done = presentation.sync(next, flows, end, { wagerSources });
  exact(done, next, flows, end);
  const returned = done.banks
    .get("p")
    .chips.find((chip) => chip.id === physical.id);
  assert(returned);
  assert.equal(returned.appearanceId, physical.appearanceId);
  assert.equal(returned.wear, physical.wear);
  assert.equal(
    done.banks.get("p").chips.filter((chip) => chip.id === physical.id).length,
    1,
  );
  assert.deepEqual(
    chipPatinaParameters(returned),
    chipPatinaParameters(physical),
  );
});

test("partial matching source chips retain their physical identities and mismatched bookkeeping falls back safely", () => {
  const source = { id: "physical-partial", type: "field", amount: 20000 };
  const old = state(80000, {
    players: [{ id: "p", seat: 0, bank: 80000, bets: [source] }],
  });
  const next = state(90000, {
    snapshotAt: 1100,
    players: [
      { id: "p", seat: 0, bank: 90000, bets: [{ ...source, amount: 10000 }] },
    ],
  });
  for (const mismatch of [false, true]) {
    const presentation = createBankChipPresentation();
    presentation.sync(old, [], 1000);
    const flows = planChipFlows(old, next, { now: 1100 }),
      flow = flows[0];
    const pile = wagerPileLayout(flow.from, next, 20000);
    const actual = chipPileSpecs(20000, {
      diameter: pile.diameter,
      seed: source.id,
    }).map((chip, index) => ({
      ...chip,
      id: `bank-origin-${index}`,
      appearanceId: `bank-skin-${index}`,
      wear: index,
      denomination: mismatch ? 2500 : chip.denomination,
      position: chip.position.map(
        (value, axis) => value + pile.basePosition[axis],
      ),
    }));
    const active = presentation.sync(next, flows, 1100, {
      wagerSources: new Map([[routeKey(flow.from), actual]]),
    });
    const plan = active.plans.get(flow.id);
    if (!mismatch) assert.deepEqual(plan.sourceSpecs, [actual[1]]);
    else
      assert(
        plan.sourceSpecs.every((chip) => !chip.id.startsWith("bank-origin")),
      );
  }
});

test("losing or pushing a black stake never converts it into green payout denominations", () => {
  for (const result of ["lose", "push"]) {
    const presentation = createBankChipPresentation();
    const bet = { id: `black-${result}`, type: "dont", amount: 10000 };
    const old = state(90000, {
      nextRollAt: 0,
      players: [{ id: "p", seat: 0, bank: 90000, bets: [bet] }],
    });
    const initial = presentation.sync(old, [], 1000).banks.get("p");
    const next = state(result === "push" ? 100000 : 90000, {
      nextRollAt: 0,
      lastRoll: {
        id: `roll-${result}`,
        at: 1100,
        events: [
          {
            playerId: "p",
            bets: [
              {
                betId: bet.id,
                amount: 10000,
                result,
                delta: result === "push" ? 0 : -10000,
              },
            ],
          },
        ],
      },
    });
    const flows = planChipFlows(old, next, { now: 1100 });
    const active = presentation.sync(next, flows, 1200),
      plan = active.plans.get(flows[0].id);
    assert.deepEqual(
      plan.chips.map((chip) => chip.denomination),
      [10000],
    );
    assert.equal(plan.profitChipIds.length, 0);
    assert.equal(plan.sourceSpecs.length, 1);
    assert.equal(
      plan.sourceSpecs[0].appearanceId,
      `${routeKey(plan.flow.from)}:0`,
    );
    const done = presentation.sync(
      next,
      flows,
      flows[0].startAt + flows[0].duration,
    );
    exact(done, next, flows, flows[0].startAt + flows[0].duration);
    assertRetained(initial, done.banks.get("p"));
    if (result === "lose")
      assert.deepEqual(done.banks.get("p").chips, initial.chips);
  }
});

test("standing profits never lift, recolour, or take credit for the wager that remains on the felt", () => {
  const presentation = createBankChipPresentation(),
    bet = { id: "standing-black", type: "place-5", amount: 10000 };
  const old = state(90000, {
    nextRollAt: 0,
    point: 6,
    players: [{ id: "p", seat: 0, bank: 90000, bets: [bet] }],
  });
  presentation.sync(old, [], 1000);
  const next = state(104000, {
    nextRollAt: 0,
    point: 6,
    players: [{ id: "p", seat: 0, bank: 104000, bets: [structuredClone(bet)] }],
    lastRoll: {
      id: "standing-win",
      at: 1100,
      events: [
        {
          playerId: "p",
          bets: [{ betId: bet.id, amount: 10000, result: "win", delta: 14000 }],
        },
      ],
    },
  });
  const flows = planChipFlows(old, next, { now: 1100 }),
    untouched = JSON.stringify(next.players[0].bets);
  const active = presentation.sync(next, flows, 1200),
    plan = active.plans.get(flows[0].id);
  assert.equal(plan.flow.sourceAmount, 0);
  assert.deepEqual(plan.sourceSpecs, []);
  assert.equal(value(plan.chips), 14000);
  assert.deepEqual(
    plan.profitChipIds,
    plan.chips.map((chip) => chip.id),
  );
  assert.equal(visualChipAmount(10000, plan.flow.from, flows, 1200), 10000);
  presentation.sync(next, flows, flows[0].startAt + flows[0].duration);
  assert.equal(JSON.stringify(next.players[0].bets), untouched);
});

test("partial take-downs preserve a real matching top chip or explicitly request source dealer change", () => {
  for (const [before, returned, expectedIndex, needsChange] of [
    [20000, 10000, 1, false],
    [10000, 2500, null, true],
  ]) {
    const presentation = createBankChipPresentation();
    const bet = { id: "partial", type: "field", amount: before };
    const old = state(100000 - before, {
      players: [{ id: "p", seat: 0, bank: 100000 - before, bets: [bet] }],
    });
    presentation.sync(old, [], 1000);
    const next = state(100000 - before + returned, {
      snapshotAt: 1100,
      players: [
        {
          id: "p",
          seat: 0,
          bank: 100000 - before + returned,
          bets: [{ ...bet, amount: before - returned }],
        },
      ],
    });
    const flows = planChipFlows(old, next, { now: 1100 }),
      active = presentation.sync(next, flows, 1100);
    const plan = active.plans.get(flows[0].id);
    assert.equal(value(plan.chips), returned);
    assert.equal(!!plan.sourceExchange, needsChange);
    if (!needsChange)
      assert.equal(
        plan.sourceSpecs[0].appearanceId,
        `${routeKey(plan.flow.from)}:${expectedIndex}`,
      );
    else {
      assert.equal(plan.sourceExchange.kind, "make-change");
      assert.equal(value(plan.sourceExchange.removed), before);
      assert.equal(plan.sourceExchange.afterAmount, before - returned);
      assert.equal(value(plan.sourceExchange.outgoing), returned);
    }
  }
});

test("the full opening preserves every departing stake's denomination, wear and geometry while issuing profits separately", () => {
  const showcase = createStartupShowcase(),
    presentation = createBankChipPresentation();
  let previous = null,
    flows = [],
    checked = 0;
  for (let now = 0; now <= 30000; now += 50) {
    const current = [...showcase.stages]
      .reverse()
      .find((stage) => stage.at <= now).state;
    if (current !== previous) {
      if (current.rolling && current.throw?.id !== previous?.throw?.id)
        flows = [];
      if (previous) flows.push(...planChipFlows(previous, current, { now }));
      previous = current;
    }
    const untouched = JSON.stringify(current);
    const displayed = presentation.sync(current, flows, now);
    exact(displayed, current, flows, now);
    assert.equal(JSON.stringify(current), untouched);
    for (const flow of flows) {
      const plan = displayed.plans.get(flow.id);
      if (!plan || flow.from.kind !== "bet") continue;
      const stake = plan.chips.filter(
        (chip) => !plan.profitChipIds.includes(chip.id),
      );
      if (flow.sourceAmount > 0) {
        const layout = wagerPileLayout(flow.from, current, flow.sourceAmount);
        const canonical = chipPileSpecs(flow.sourceAmount, {
          diameter: layout.diameter,
          seed: flow.from.bet.id,
        });
        assert.deepEqual(
          stake.map((chip) => [chip.denomination, chip.wear]),
          canonical.map((chip) => [chip.denomination, chip.wear]),
        );
        assert.deepEqual(
          plan.sourceSpecs.map((chip) => chip.rotation),
          canonical.map((chip) => chip.rotation),
        );
        assert.equal(value(stake), flow.sourceAmount);
        checked++;
      } else assert.equal(plan.sourceSpecs.length, 0);
      assert.equal(value(plan.chips), flow.amount);
      assert.equal(
        value(
          plan.chips.filter((chip) => plan.profitChipIds.includes(chip.id)),
        ),
        Math.max(0, flow.amount - flow.sourceAmount),
      );
    }
    flows = flows.filter(
      (flow) =>
        now < Math.min(flow.startAt + flow.duration, flow.cutAt ?? Infinity),
    );
  }
  assert(
    checked > 50,
    "Both physical throws and settlement cohorts were exercised over time",
  );
});
