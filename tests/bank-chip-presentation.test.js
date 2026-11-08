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
} from "../src/chip-flow.js";

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
