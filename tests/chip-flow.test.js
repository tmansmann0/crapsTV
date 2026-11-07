import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  planChipFlows,
  visualChipAmount,
  bankRoute,
  betRoute,
  sampleChipFlow,
  arcPosition,
  bankChipStacks,
  SEAT_LAYOUT,
  seatStackSlot,
  lineWagerX,
} from "../src/chip-flow.js";

const wager = { id: "b1", type: "pass", amount: 500, point: null };
function state(bank = 10000, bets = []) {
  return {
    code: "FLOWAA",
    createdAt: 1,
    status: "playing",
    snapshotAt: 1000,
    config: { mode: "craps" },
    lastRoll: null,
    players: [{ id: "p1", name: "A", seat: 0, bank, bets, left: false }],
  };
}
function finish(previous, bank, bets, outcomes, at = 1000) {
  const next = state(bank, bets);
  next.lastRoll = {
    id: "r1",
    at,
    events: [{ playerId: "p1", bets: outcomes }],
  };
  return next;
}

test("first join, reconnect baselines, and another room do not replay chip motions", () => {
  const next = state(9500, [wager]);
  assert.deepEqual(planChipFlows(null, next), []);
  assert.deepEqual(planChipFlows({ ...next, code: "OLDROOM" }, next), []);
  assert.deepEqual(planChipFlows({ ...next, createdAt: 0 }, next), []);
});
test("a wager leaves the bank and enters the betting stack only at arrival", () => {
  const old = state(),
    next = state(9500, [wager]);
  const flows = planChipFlows(old, next, { now: 1000 });
  assert.equal(flows.length, 1);
  assert.equal(flows[0].kind, "wager");
  assert.equal(flows[0].amount, 500);
  assert.equal(visualChipAmount(9500, bankRoute("p1"), flows, 999), 10000);
  assert.equal(visualChipAmount(500, betRoute("p1", wager), flows, 1100), 0);
  assert.equal(visualChipAmount(500, betRoute("p1", wager), flows, 2200), 500);
});
test("closed wins visibly return stake plus profit, without crediting a second stake", () => {
  const old = state(9500, [wager]);
  const next = finish(
    old,
    10500,
    [],
    [{ betId: "b1", result: "win", amount: 500, delta: 500 }],
  );
  const flows = planChipFlows(old, next, { now: 1000 });
  assert.equal(flows.length, 1);
  assert.equal(flows[0].amount, 1000);
  assert.equal(flows[0].sourceAmount, 500);
  assert.equal(visualChipAmount(10500, bankRoute("p1"), flows, 1500), 9500);
  assert.equal(visualChipAmount(10500, bankRoute("p1"), flows, 2300), 10500);
});
test("standing place wins leave the whole stake and send only profit home", () => {
  const place = { id: "b1", type: "place-6", amount: 600 };
  const old = state(9400, [place]);
  const next = finish(
    old,
    10100,
    [place],
    [{ betId: "b1", result: "win", amount: 600, delta: 700 }],
  );
  const flows = planChipFlows(old, next, { now: 1000 });
  assert.equal(flows[0].amount, 700);
  assert.equal(flows[0].sourceAmount, 0);
  assert.equal(visualChipAmount(600, betRoute("p1", place), flows, 1100), 600);
});
test("losses go to the dealer and a push returns only its original stake", () => {
  const old = state(9500, [wager]);
  const loss = planChipFlows(
    old,
    finish(
      old,
      9500,
      [],
      [{ betId: "b1", result: "lose", amount: 500, delta: -500 }],
    ),
    { now: 1000 },
  );
  assert.equal(loss[0].to.kind, "dealer");
  assert.equal(loss[0].amount, 500);
  const push = planChipFlows(
    old,
    finish(
      old,
      10000,
      [],
      [{ betId: "b1", result: "push", amount: 500, delta: 0 }],
    ),
    { now: 1000 },
  );
  assert.equal(push[0].kind, "return");
  assert.equal(push[0].amount, 500);
});
test("net-zero rounds still animate each winning and losing bet independently", () => {
  const field = { ...wager, id: "b2", type: "field" };
  const old = state(9000, [wager, field]);
  const next = finish(
    old,
    10000,
    [],
    [
      { betId: "b1", result: "win", amount: 500, delta: 500 },
      { betId: "b2", result: "lose", amount: 500, delta: -500 },
    ],
  );
  const flows = planChipFlows(old, next, { now: 1000 });
  assert.deepEqual(
    flows.map((f) => [f.kind, f.amount]),
    [
      ["win", 1000],
      ["loss", 500],
    ],
  );
});
test("coalesced standing-win and raise snapshots preserve profit and outgoing chips", () => {
  const place = { id: "b1", type: "place-6", amount: 600 };
  const old = state(9400, [place]);
  const next = finish(
    old,
    9500,
    [{ ...place, amount: 1200 }],
    [{ betId: "b1", result: "win", amount: 600, delta: 700 }],
  );
  const flows = planChipFlows(old, next, { now: 1000 });
  assert.deepEqual(
    flows.map((f) => [f.kind, f.amount]),
    [
      ["win", 700],
      ["wager", 600],
    ],
  );
  assert.equal(visualChipAmount(1200, betRoute("p1", place), flows, 1100), 600);
});
test("coalesced win and take-down returns profit and stake without mislabeling the standing win", () => {
  const place = { id: "b1", type: "place-6", amount: 600 };
  const old = state(9400, [place]);
  const next = finish(
    old,
    10700,
    [],
    [{ betId: "b1", result: "win", amount: 600, delta: 700 }],
  );
  const flows = planChipFlows(old, next, { now: 1000 });
  assert.deepEqual(
    flows.map((f) => [f.kind, f.amount]),
    [
      ["win", 700],
      ["return", 600],
    ],
  );
});
test("coalesced loss and re-up shows a separate new buy-in from the house", () => {
  const old = state(0, [wager]);
  const next = finish(
    old,
    10000,
    [],
    [{ betId: "b1", result: "lose", amount: 500, delta: -500 }],
  );
  const flows = planChipFlows(old, next, { now: 1000 });
  assert.deepEqual(
    flows.map((f) => [f.kind, f.amount]),
    [
      ["loss", 500],
      ["reup", 10000],
    ],
  );
});
test("take-downs, traveled come bets, and re-ups each have the correct source", () => {
  const old = state(9500, [wager]);
  const taken = planChipFlows(old, state(10000), { now: 1000 });
  assert.equal(taken[0].from.kind, "bet");
  assert.equal(taken[0].to.kind, "bank");
  const come = { ...wager, type: "come" },
    moved = { ...come, point: 6 };
  const traveled = planChipFlows(state(9500, [come]), state(9500, [moved]), {
    now: 1000,
  });
  assert.equal(traveled[0].kind, "travel");
  assert.equal(traveled[0].amount, 500);
  assert.equal(traveled[0].to.bet.point, 6);
  const reup = planChipFlows(state(0), state(10000), { now: 1000 });
  assert.equal(reup[0].kind, "reup");
  assert.equal(reup[0].from.kind, "dealer");
});
test("old settlement snapshots are not misidentified as fresh removals or re-ups", () => {
  const old = state(9500, [wager]);
  const next = finish(
    old,
    10500,
    [],
    [{ betId: "b1", result: "win", amount: 500, delta: 500 }],
  );
  assert.deepEqual(planChipFlows(old, next, { now: 10000 }), []);
});
test("a flight can be sought to a shared timestamp and reaches its exact endpoints", () => {
  const flow = planChipFlows(state(), state(9500, [wager]), { now: 1000 })[0];
  assert.deepEqual(arcPosition([0, 0.7, 4], [2, 0.02, 0], 0), [0, 0.7, 4]);
  const end = arcPosition([0, 0.7, 4], [2, 0.02, 0], 1);
  assert(Math.abs(end[1] - 0.02) < 1e-9);
  assert.equal(end[0], 2);
  assert.equal(end[2], 0);
  assert.deepEqual(sampleChipFlow(flow, 1400), sampleChipFlow(flow, 1400));
  assert.equal(sampleChipFlow(flow, 2300).done, true);
});
test("different receipt times use the same server snapshot timestamp for flight starts", () => {
  const old = state(),
    next = state(9500, [wager]);
  assert.deepEqual(
    planChipFlows(old, next, { now: 1010 }),
    planChipFlows(old, next, { now: 1260 }),
  );
});
test("fallback bank slots match the Blender tray JSON and fit the usable footprint", () => {
  const metadata = JSON.parse(
    readFileSync(
      new URL(
        "../public/assets/table-player-rails-layout.json",
        import.meta.url,
      ),
    ),
  );
  for (const [index, seat] of SEAT_LAYOUT.entries()) {
    const actual = metadata.seats[index];
    assert.deepEqual(seat.center, actual.bankBase);
    assert.deepEqual(seat.label, actual.labelPosition);
    for (let slot = 0; slot < 10; slot++) {
      const position = seatStackSlot(seat, slot);
      position.forEach((v, axis) =>
        assert(Math.abs(v - actual.stackSlots[slot].position[axis]) < 1e-8),
      );
      const delta = position.map((v, axis) => v - seat.center[axis]);
      const tangent = delta.reduce(
        (sum, v, axis) => sum + v * seat.tangent[axis],
        0,
      );
      const outward = delta.reduce(
        (sum, v, axis) => sum + v * seat.outward[axis],
        0,
      );
      assert(Math.abs(tangent) + 0.115 <= 0.74);
      assert(Math.abs(outward) + 0.115 <= 0.31);
    }
  }
});
test("twelve line wagers have distinct non-overlapping label slots and a clear center legend", () => {
  const positions = Array.from({ length: 12 }, (_, seat) =>
    lineWagerX(seat),
  ).sort((a, b) => a - b);
  assert.equal(new Set(positions).size, 12);
  for (let i = 1; i < positions.length; i++)
    assert(positions[i] - positions[i - 1] >= 0.65);
  assert(positions.every((x) => Math.abs(x) >= 1.04 && Math.abs(x) <= 4.36));
});
test("bank stacks keep exact denomination counts while bounding visible geometry", () => {
  const stacks = bankChipStacks(100000);
  assert.equal(
    stacks.reduce((n, s) => n + s.count * s.denomination, 0),
    100000,
  );
  assert(stacks.reduce((n, s) => n + s.visibleCount, 0) <= 24);
  assert(
    bankChipStacks(100000000).reduce((n, s) => n + s.visibleCount, 0) <= 24,
  );
  const large = bankChipStacks(100093700);
  assert.equal(
    large.reduce((n, s) => n + s.count * s.denomination, 0),
    100093700,
  );
  assert(large.reduce((n, s) => n + s.visibleCount, 0) <= 24);
  assert(large.some((s) => s.denomination === 100));
  assert.equal(SEAT_LAYOUT.length, 12);
  assert.equal(SEAT_LAYOUT.filter((s) => s.center[2] === 3.91).length, 6);
});
