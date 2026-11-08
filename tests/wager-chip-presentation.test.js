import test from "node:test";
import assert from "node:assert/strict";
import { createWagerChipPresentation } from "../src/wager-chip-presentation.js";
import { chipPileSpecs } from "../src/wager-layout.js";
import { chipPatinaParameters } from "../src/chip-character.js";

const canonical = (amount, seed = "bet") =>
  chipPileSpecs(amount, { diameter: 0.31, seed }).map((chip, index) => ({
    ...chip,
    id: `route:${seed}:${index}`,
    position: chip.position.map((v, a) => v + [1, 0.014, 2][a]),
  }));
const value = (chips) => chips.reduce((n, chip) => n + chip.denomination, 0);
const incoming = (id, denomination, wear = 1) => ({
  id,
  denomination,
  wear,
  appearanceId: `patina:${id}`,
});
const signature = (chip) => ({
  id: chip.id,
  denomination: chip.denomination,
  wear: chip.wear,
  appearanceId: chip.appearanceId,
});

test("a cold canonical baseline is unchanged geometry and does not fabricate a dealer exchange", () => {
  const book = createWagerChipPresentation(),
    specs = canonical(12500);
  const result = book.reconcile("pass", specs);
  assert.equal(result.exchange, null);
  assert.equal(value(result.chips), 12500);
  assert.deepEqual(
    result.chips.map((c) => c.id),
    specs.map((c) => c.id),
  );
  for (let i = 0; i < specs.length; i++) {
    assert.deepEqual(result.chips[i].position, specs[i].position);
    assert.deepEqual(result.chips[i].rotation, specs[i].rotation);
    assert.equal(result.chips[i].diameter, specs[i].diameter);
  }
  assert.deepEqual(result.removed, []);
});

test("raising$20to$25 is an explicit five-red to one-green exchange with a new physical ID", () => {
  const book = createWagerChipPresentation(),
    before = book.reconcile("pass", canonical(2000));
  const red = incoming("bank-red", 500, 2),
    next = book.reconcile("pass", canonical(2500), { incoming: [red] });
  assert.equal(next.chips.length, 1);
  assert.equal(next.chips[0].denomination, 2500);
  assert(!before.chips.some((c) => c.id === next.chips[0].id));
  assert.notEqual(next.chips[0].id, red.id);
  assert.equal(next.exchange.removed.length, 5);
  assert.equal(value(next.exchange.removed), 2500);
  assert.deepEqual(next.exchange.added, next.chips);
  assert(
    next.exchange.removed.every(
      (c) =>
        c.position.every(Number.isFinite) && c.rotation.every(Number.isFinite),
    ),
  );
  assert.deepEqual(
    new Set(next.removed.map((c) => c.id)),
    new Set(before.chips.map((c) => c.id)),
  );
});

test("normal incoming$100+$25 and later growth retain actual IDs, wear and appearance", () => {
  const book = createWagerChipPresentation(),
    black = incoming("black", 10000, 2),
    green = incoming("green", 2500, 0);
  const first = book.reconcile("pass", canonical(12500), {
    incoming: [black, green],
  });
  assert.equal(first.exchange, null);
  assert.deepEqual(first.chips.map(signature), [black, green]);
  const extra = incoming("green2", 2500, 1),
    next = book.reconcile("pass", canonical(15000), { incoming: [extra] });
  assert.equal(next.exchange, null);
  assert.deepEqual(
    next.chips.slice(0, 2).map(signature),
    first.chips.map(signature),
  );
  assert.equal(next.chips[2].id, extra.id);
  assert.deepEqual(
    chipPatinaParameters(next.chips[0]),
    chipPatinaParameters(black),
  );
});

test("partial exact withdrawal preserves remaining real chips without a false exchange", () => {
  const book = createWagerChipPresentation(),
    old = book.reconcile("pass", canonical(12500));
  const black = old.chips.find((c) => c.denomination === 10000),
    green = old.chips.find((c) => c.denomination === 2500);
  const next = book.reconcile("pass", canonical(2500), {
    outgoingIds: [black.id],
  });
  assert.equal(next.exchange, null);
  assert.deepEqual(next.removed, [black]);
  assert.deepEqual(signature(next.chips[0]), signature(green));
  assert.deepEqual(next.chips[0].position, canonical(2500)[0].position);
  assert.deepEqual(next.added, []);
});

test("incoming bank geometry cannot change canonical wager dimensions or collider transforms", () => {
  const book = createWagerChipPresentation();
  const geometry = canonical(10000)[0];
  const physical = {
    ...incoming("bank-black", 10000),
    diameter: 0.23,
    thicknessScale: 1.15,
    position: [9, 9, 9],
    rotation: [1, 2, 3],
    opacity: 0.25,
  };
  const result = book.reconcile("pass", [geometry], { incoming: [physical] });
  assert.equal(result.chips[0].id, physical.id);
  for (const key of [
    "position",
    "rotation",
    "diameter",
    "thicknessScale",
    "opacity",
  ])
    assert.deepEqual(result.chips[0][key], geometry[key]);
});

test("unchanged amounts and traveled positions do not repaint any chip", () => {
  const book = createWagerChipPresentation(),
    before = book.reconcile("pass", canonical(19400));
  const moved = canonical(19400).map((c) => ({
    ...c,
    position: c.position.map((v, a) => v + (a === 0 ? 3 : 0)),
    rotation: [0.01, 0.7, 0.003],
  }));
  const next = book.reconcile("pass", moved);
  assert.equal(next.exchange, null);
  assert.deepEqual(next.added, []);
  assert.deepEqual(next.removed, []);
  assert.deepEqual(next.chips.map(signature), before.chips.map(signature));
  for (let i = 0; i < moved.length; i++) {
    assert.deepEqual(next.chips[i].position, moved[i].position);
    assert.deepEqual(next.chips[i].rotation, moved[i].rotation);
  }
});

test("five incoming black chips exchanged for a purple chip never reuse a black ID", () => {
  const book = createWagerChipPresentation(),
    black = Array.from({ length: 5 }, (_, i) =>
      incoming(`b${i}`, 10000, i % 3),
    );
  const next = book.reconcile("pass", canonical(50000), { incoming: black });
  assert(next.exchange);
  assert.equal(next.exchange.removed.length, 5);
  assert.equal(value(next.exchange.removed), 50000);
  assert.equal(value(next.exchange.added), 50000);
  assert(!black.some((c) => c.id === next.chips[0].id));
});

test("an exchange only replaces changed denominations and leaves an unaffected black chip intact", () => {
  const book = createWagerChipPresentation(),
    old = book.reconcile("pass", canonical(12000));
  const next = book.reconcile("pass", canonical(12500), {
    incoming: [incoming("extra-red", 500)],
  });
  assert.equal(next.chips[0].id, old.chips[0].id);
  assert.equal(next.exchange.removed.length, 5);
  assert.equal(next.exchange.added.length, 1);
  assert(next.exchange.removed.every((c) => c.denomination === 500));
  assert.equal(next.exchange.added[0].denomination, 2500);
});

test("a full outgoing pile and an already-visualized source change are not exchanged twice", () => {
  const book = createWagerChipPresentation(),
    before = book.reconcile("pass", canonical(10000));
  const empty = book.reconcile("pass", [], {
    outgoingIds: before.chips.map((c) => c.id),
  });
  assert.equal(empty.exchange, null);
  assert.deepEqual(empty.removed, before.chips);
  const old = book.reconcile("odds", canonical(10000, "odds"));
  const children = [...Array(3)].map((_, i) => incoming(`g${i}`, 2500));
  children.push(...Array.from({ length: 4 }, (_, i) => incoming(`r${i}`, 500)));
  const changed = book.reconcile("odds", canonical(9500, "odds"), {
    incoming: children,
    sourceExchangeRemoved: old.chips,
  });
  assert(changed.exchange);
  assert.deepEqual(changed.exchange.removed, []);
  assert.equal(value(changed.exchange.added), 9500);
  assert(!changed.exchange.removed.some((c) => c.id === old.chips[0].id));
});

test("duplicate incoming descriptors cannot create two copies of one physical chip", () => {
  const book = createWagerChipPresentation(),
    one = incoming("one", 2500);
  const next = book.reconcile("pass", canonical(5000), {
    incoming: [one, one],
  });
  assert.equal(new Set(next.chips.map((c) => c.id)).size, 2);
  assert.equal(next.chips.filter((c) => c.id === one.id).length, 1);
  assert.throws(
    () =>
      book.reconcile("other", canonical(2500), {
        incoming: [one, { ...one, denomination: 500 }],
      }),
    /cannot change/,
  );
  const before = book.snapshot("pass");
  assert.throws(
    () =>
      book.reconcile("pass", canonical(5000), {
        incoming: [{ ...one, wear: 2 }],
      }),
    /cannot change/,
  );
  assert.deepEqual(book.snapshot("pass"), before);
});

test("snapshots and source maps are isolated copies; bounded routes can be pruned and cleared", () => {
  const book = createWagerChipPresentation({ maxRoutes: 2 });
  book.reconcile("a", canonical(500));
  book.reconcile("b", canonical(2500, "b"));
  assert.throws(() => book.reconcile("c", canonical(10000, "c")), /Too many/);
  const before = book.get("a"),
    source = book.sources();
  source.get("a")[0].position[0] = 999;
  before.chips[0].wear = 2;
  assert.notEqual(book.snapshot("a").chips[0].position[0], 999);
  assert.notEqual(book.snapshot("a").chips[0].wear, 2);
  book.prune(["b"]);
  assert.equal(book.size, 1);
  assert.deepEqual(book.get("a"), { chips: [] });
  book.reconcile("c", canonical(10000, "c"));
  assert.equal(book.size, 2);
  book.clear();
  assert.equal(book.size, 0);
  assert.equal(book.sources().size, 0);
});
