import test from "node:test";
import assert from "node:assert/strict";
import { createBankChipInventory } from "../src/bank-chip-inventory.js";
const total = (chips) => chips.reduce((n, c) => n + c.denomination, 0);
const identity = (chip) => ({
  id: chip.id,
  denomination: chip.denomination,
  wear: chip.wear,
});
function exact(s) {
  assert.equal(total(s.chips) + s.reserveCents, s.amount);
  assert(s.chips.length <= 100);
  assert(s.stacks.length <= 10);
  assert.equal(new Set(s.chips.map((c) => c.id)).size, s.chips.length);
  for (const stack of s.stacks) {
    assert(stack.count <= 10);
    assert(
      stack.chips.every(
        (c) => c.slot === stack.slot && c.denomination === stack.denomination,
      ),
    );
    assert.deepEqual(
      stack.chips.map((c) => c.level),
      Array.from({ length: stack.count }, (_, i) => i),
    );
  }
}

test("a normal$1000/$5 bank starts with49 actual mixed chips rather than eight recoloured tokens", () => {
  const i = createBankChipInventory({ namespace: "room1" }),
    s = i.update("bank:p", 100000, { minBet: 500, startingBank: 100000 });
  exact(s);
  assert.equal(s.chips.length, 49);
  assert.equal(s.reserveCents, 0);
  assert.deepEqual(
    Object.fromEntries(
      [100, 500, 2500, 10000].map((d) => [
        d,
        s.chips.filter((c) => c.denomination === d).length,
      ]),
    ),
    { 100: 10, 500: 18, 2500: 16, 10000: 5 },
  );
});

test("the old$800→$795 denomination threshold removes one real$5 without changing other chips", () => {
  const i = createBankChipInventory(),
    a = i.update("bank:p", 80000),
    b = i.update("bank:p", 79500);
  exact(b);
  assert.equal(b.removed.length, 1);
  assert.equal(b.removed[0].denomination, 500);
  assert.deepEqual(
    b.chips,
    a.chips.filter((c) => c.id !== b.removed[0].id),
  );
  assert(b.chips.some((c) => c.denomination === 10000));
  assert.equal(b.exchanges.length, 0);
});

test("a small win stacks new arrivals while preserving every surviving ID, wear and position", () => {
  const i = createBankChipInventory(),
    a = i.update("bank:p", 100000),
    incoming = { id: "payout:5:red", denomination: 500, wear: 2 };
  const b = i.update("bank:p", 100500, {
    incomingChips: [incoming],
    flowId: "payout5",
  });
  exact(b);
  assert.deepEqual(
    b.chips.filter((c) => c.id !== incoming.id),
    a.chips,
  );
  assert.equal(b.added.length, 1);
  assert.deepEqual(identity(b.added[0]), incoming);
  assert.equal(b.added[0].denomination, 500);
  assert(b.added[0].level > 0);
});

test("an exact$1 withdrawal breaks a$100 only through explicit value-conserving dealer changes", () => {
  const i = createBankChipInventory();
  const a = i.update("wager:p:a", 10000, { initialMode: "wager" });
  const b = i.spend("wager:p:a", 100, { flowId: "change-one" });
  exact(b);
  assert.equal(b.amount, 9900);
  assert.equal(total(b.outgoingChips), 100);
  assert.equal(b.exchanges.filter((e) => e.kind === "make-change").length, 3);
  for (const e of b.exchanges) assert.equal(total(e.removed), total(e.added));
  assert.equal(b.exchanges[0].removed[0].id, a.chips[0].id);
  assert(!b.chips.some((c) => c.id === a.chips[0].id));
});

test("actual outgoing chips retain the same identities through a wager and return payout", () => {
  const i = createBankChipInventory(),
    bank = i.update("bank:p", 100000);
  const outgoing = i.spend("bank:p", 5000, { flowId: "bet" }).removed;
  assert.equal(total(outgoing), 5000);
  const wager = i.deposit("wager:p:a", outgoing);
  exact(wager);
  assert.deepEqual(wager.chips.map(identity), outgoing.map(identity));
  const returning = i.spend("wager:p:a", 5000).removed;
  const result = i.deposit("bank:p", returning);
  exact(result);
  assert.equal(result.amount, bank.amount);
  assert.deepEqual(
    result.chips.map(identity).sort((a, b) => a.id.localeCompare(b.id)),
    bank.chips.map(identity).sort((a, b) => a.id.localeCompare(b.id)),
  );
});

test("future landing previews are pure and commit exactly the planned chip IDs and slots", () => {
  const i = createBankChipInventory();
  i.update("bank:p", 100000);
  const before = i.snapshot("bank:p"),
    incoming = [{ id: "flight1", denomination: 2500, wear: 1 }];
  const a = i.previewDeposit("bank:p", incoming),
    b = i.previewDeposit("bank:p", incoming);
  assert.deepEqual(i.snapshot("bank:p"), before);
  assert.deepEqual(a, b);
  const real = i.deposit("bank:p", incoming);
  assert.deepEqual(real, a);
  const spend = i.previewSpend("bank:p", 600);
  assert.deepEqual(i.snapshot("bank:p").chips, real.chips);
  assert.deepEqual(i.spend("bank:p", 600), spend);
});

test("player inventories are independent and reconnect initial mixes are deterministic per room", () => {
  const i = createBankChipInventory({ namespace: "room:created1" }),
    a = i.update("bank:a", 100000),
    b = i.update("bank:b", 100000);
  assert(!a.chips.some((c) => b.chips.some((x) => x.id === c.id)));
  i.spend("bank:a", 500);
  assert.deepEqual(i.snapshot("bank:b").chips, b.chips);
  const reconnected = createBankChipInventory({ namespace: "room:created1" });
  assert.deepEqual(reconnected.update("bank:b", 100000).chips, b.chips);
  assert.equal(i.resetRoom("room:created1"), false);
  assert(i.snapshot("bank:b"));
  assert.equal(i.resetRoom("room:created2"), true);
  assert.equal(i.snapshot("bank:b"), null);
  assert.notDeepEqual(
    i.update("bank:b", 100000).chips.map((c) => c.id),
    b.chips.map((c) => c.id),
  );
});

test("capacity changes colour up only through explicit exchanges, not repainting surviving identities", () => {
  const i = createBankChipInventory({ slots: 2, perStack: 5 });
  i.update("bank:p", 0, { initialMode: "wager" });
  const chips = Array.from({ length: 12 }, (_, n) => ({
    id: `hundred-${n}`,
    denomination: 10000,
    wear: n % 3,
  }));
  const result = i.deposit("bank:p", chips);
  assert.equal(total(result.chips) + result.reserveCents, 120000);
  assert(result.stacks.length <= 2 && result.stacks.every((s) => s.count <= 5));
  assert(
    result.exchanges.some((e) => e.kind === "color-up" || e.kind === "vault"),
  );
  for (const c of result.chips) {
    const original = chips.find((x) => x.id === c.id);
    if (original) assert.deepEqual(identity(c), original);
  }
  for (const e of result.exchanges)
    if (e.kind === "color-up") assert.equal(total(e.removed), total(e.added));
});

test("million-dollar banks are bounded and explicitly reserve value that cannot fit real$1000chips", () => {
  const i = createBankChipInventory(),
    a = i.update("bank:p", 100000000);
  exact(a);
  assert(a.reserveCents > 0);
  assert(a.chips.every((c) => c.denomination <= 100000));
  const b = i.spend("bank:p", 100000000);
  exact(b);
  assert.equal(b.chips.length, 0);
  assert.equal(total(b.removed) + b.reserveSpent, 100000000);
});

test("invalid money or recoloured incoming identities fail atomically without altering a bank", () => {
  const i = createBankChipInventory(),
    a = i.update("bank:p", 100000);
  for (const amount of [-100, 1.2, Number.MAX_SAFE_INTEGER + 1])
    assert.throws(() => i.update("bank:p", amount));
  assert.throws(
    () =>
      i.update("bank:p", 100500, {
        incomingChips: [{ ...a.chips[0], denomination: 500 }],
      }),
    /change denomination|duplicated/,
  );
  assert.throws(
    () =>
      i.update("bank:p", 100500, {
        incomingChips: [{ id: "too-much", denomination: 2500, wear: 0 }],
      }),
    /exceed/,
  );
  assert.deepEqual(i.snapshot("bank:p").chips, a.chips);
});

test("fractional starting banks retain every cent explicitly without inventing a$1 chip", () => {
  for (const amount of [100050, 12345, 50, 1, 0]) {
    const i = createBankChipInventory(),
      s = i.update("bank:p", amount, { startingBank: amount, minBet: 100 });
    exact(s);
    assert.equal(s.reserveCents % 100, amount % 100);
    assert(s.chips.every((c) => c.denomination >= 100));
    if (amount < 100) {
      assert.equal(s.chips.length, 0);
      assert.equal(s.reserveCents, amount);
    }
  }
});

test("whole-dollar bets preserve fractional cash and re-up conserves a supported$1000.50 buy-in", () => {
  const i = createBankChipInventory(),
    a = i.update("bank:p", 100050, { startingBank: 100050, minBet: 500 });
  const b = i.spend("bank:p", 500);
  exact(b);
  assert.equal(b.reserveCents, 50);
  i.update("bank:p", 50);
  const reup = i.update("bank:p", 100050);
  exact(reup);
  assert.equal(reup.reserveCents, 50);
  const cash = i.spend("bank:p", 25);
  exact(cash);
  assert.equal(cash.reserveCents, 25);
  assert.equal(cash.reserveSpent, 25);
  assert.equal(a.amount, 100050);
});

test("fractional outgoing amounts use explicit cash-change when no fractional reserve exists", () => {
  const i = createBankChipInventory();
  i.update("bank:p", 10000, { initialMode: "wager" });
  const s = i.spend("bank:p", 150);
  exact(s);
  assert.equal(s.amount, 9850);
  assert.equal(total(s.removed) + s.reserveSpent, 150);
  assert.equal(s.reserveCents, 50);
  const cash = s.exchanges.find((e) => e.kind === "cash-change");
  assert(cash);
  assert.equal(total(cash.removed), total(cash.added) + cash.reserveDelta);
});

test("preview-generated arrival identities cannot collide with a later minted chip", () => {
  const i = createBankChipInventory();
  i.update("bank:p", 100000);
  const plan = i.previewUpdate("bank:p", 100500);
  i.update("bank:p", 100500, { incomingChips: plan.added });
  const later = i.update("bank:p", 101000);
  exact(later);
  assert.equal(new Set(later.chips.map((c) => c.id)).size, later.chips.length);
});

test("sequence previews reserve distinct landing heights/withdrawals without committing any state", () => {
  const i = createBankChipInventory();
  const before = i.update("bank:p", 100000);
  const operations = [
    { routeId: "bank:p", amount: 100500 },
    { routeId: "bank:p", amount: 101000 },
  ];
  const planned = i.previewSequence(operations);
  assert.notEqual(planned[0].added[0].id, planned[1].added[0].id);
  assert.notEqual(planned[0].added[0].level, planned[1].added[0].level);
  assert.deepEqual(i.snapshot("bank:p").chips, before.chips);
  const committed = operations.map(({ routeId, amount }) =>
    i.update(routeId, amount),
  );
  assert.deepEqual(committed, planned);
  const withdrawals = i.previewSequence([
    { routeId: "bank:p", amount: 100500 },
    { routeId: "bank:p", amount: 100000 },
  ]);
  assert.notEqual(withdrawals[0].removed[0].id, withdrawals[1].removed[0].id);
});

test("a failed later preview operation rolls back route contents, identities and serial counters", () => {
  const i = createBankChipInventory();
  i.update("bank:p", 100000);
  const before = i.snapshot("bank:p"),
    next = i.previewUpdate("bank:p", 100500);
  assert.throws(() =>
    i.previewSequence([
      { routeId: "bank:p", amount: 100500 },
      { routeId: "bank:p", amount: -1 },
    ]),
  );
  assert.deepEqual(i.snapshot("bank:p"), before);
  assert.deepEqual(i.update("bank:p", 100500), next);
});

test("a long sequence of bets and wins conserves money and never mutates a retained chip's denomination", () => {
  const i = createBankChipInventory(),
    known = new Map();
  let amount = 100000;
  for (let n = 0; n < 100; n++) {
    amount += n % 3 === 0 ? 700 : -300;
    const s = i.update("bank:p", amount);
    exact(s);
    for (const chip of s.chips) {
      if (known.has(chip.id))
        assert.deepEqual(identity(chip), known.get(chip.id));
      known.set(chip.id, identity(chip));
    }
  }
});

test("repeated red-chip wins color up only at capacity without hiding ordinary winnings", () => {
  const i = createBankChipInventory();
  let bank = i.update("p", 100000);
  let exchanges = 0;
  for (let n = 0; n < 180; n++) {
    const before = bank;
    bank = i.deposit("p", [
      { id: `red-win:${n}`, denomination: 500, wear: n % 3 },
    ]);
    exact(bank);
    assert.equal(bank.reserveCents, 0);
    exchanges += bank.exchanges.filter((e) => e.kind === "color-up").length;
    const changed = new Set(
      bank.exchanges.flatMap((e) => e.removed.map((c) => c.id)),
    );
    for (const chip of before.chips)
      if (!changed.has(chip.id))
        assert.deepEqual(
          identity(bank.chips.find((c) => c.id === chip.id)),
          identity(chip),
        );
    if (bank.exchanges.length) assert.equal(before.stacks.length, 10);
  }
  assert(exchanges > 0);
});

test("capacity color-up combines full lower stacks when an isolated exchange cannot free a slot", () => {
  const i = createBankChipInventory({ slots: 2, perStack: 5 });
  i.update("p", 0);
  const s = i.deposit(
    "p",
    Array.from({ length: 11 }, (_, n) => ({
      id: `white:${n}`,
      denomination: 100,
      wear: 0,
    })),
  );
  assert.equal(s.reserveCents, 0);
  const e = s.exchanges.find((e) => e.kind === "color-up");
  assert.equal(e.removed.length, 10);
  assert.equal(e.added.length, 2);
  assert.equal(total(e.removed), total(e.added));
});
