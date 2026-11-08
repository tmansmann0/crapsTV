import test from "node:test";
import assert from "node:assert/strict";
import {
  mobilePayouts,
  freshMobileSettlement,
} from "../src/mobile-settlement.js";
const bet = { id: "p", type: "pass", amount: 500 };
const roll = (bets) => ({
  id: "r",
  at: 10000,
  events: [{ playerId: "a", bets }],
});
const outcome = (betId, result, amount, delta, label = "Pass Line") => ({
  betId,
  result,
  amount,
  delta,
  label,
});

test("closed winner returns its stake as well as profit; losing bets have no payout", () => {
  const result = mobilePayouts(
    roll([outcome("p", "win", 500, 500), outcome("f", "lose", 500, -500)]),
    [bet, { id: "f", type: "field", amount: 500 }],
    "a",
  );
  assert.equal(result.length, 1);
  assert.equal(result[0].profit, 500);
  assert.equal(result[0].returnedStake, 500);
  assert.equal(result[0].total, 1000);
});
test("standing place, hardway and big winners send only profit home", () => {
  for (const type of ["place-6", "hard-6", "big-6"]) {
    const [p] = mobilePayouts(
      roll([outcome("p", "win", 600, 700)]),
      [{ ...bet, type, amount: 600 }],
      "a",
    );
    assert.equal(p.total, 700);
    assert.equal(p.returnedStake, 0);
    assert.equal(p.standing, true);
  }
});
test("push returns stake with no invented profit, and ignores another player", () => {
  const [p] = mobilePayouts(roll([outcome("p", "push", 500, 0)]), [bet], "a");
  assert.equal(p.profit, 0);
  assert.equal(p.total, 500);
  assert.deepEqual(
    mobilePayouts(roll([outcome("p", "win", 500, 500)]), [bet], "b"),
    [],
  );
});
test("odds preserve exact parent row; traveled come odds point at the number", () => {
  const odds = { id: "o", type: "odds", parent: "p", amount: 600 };
  const event = roll([outcome("o", "win", 600, 1200, "Take odds")]);
  assert.deepEqual(mobilePayouts(event, [bet, odds], "a")[0].anchors, [
    "odds:p",
    "odds-cue:pass",
    "pass",
  ]);
  assert.deepEqual(
    mobilePayouts(event, [{ ...bet, type: "come", point: 4 }, odds], "a")[0]
      .anchors,
    ["place-4"],
  );
});
test("first mount, reconnect baseline, old roll and duplicate snapshot cannot replay payouts", () => {
  const before = {
    code: "AAA",
    createdAt: 1,
    status: "playing",
    players: [{ id: "a", bets: [bet] }],
  };
  const after = {
    ...before,
    snapshotAt: 10001,
    lastRoll: roll([outcome("p", "win", 500, 500)]),
  };
  assert.equal(freshMobileSettlement(null, after, "a"), null);
  assert.equal(freshMobileSettlement(after, after, "a"), null);
  assert.equal(
    freshMobileSettlement(before, { ...after, snapshotAt: 20000 }, "a"),
    null,
  );
  assert.equal(
    freshMobileSettlement({ ...before, code: "BBB" }, after, "a"),
    null,
  );
  assert.equal(
    freshMobileSettlement(before, { ...after, rolling: true }, "a"),
    null,
  );
  assert.equal(
    freshMobileSettlement(before, after, "a").entries[0].total,
    1000,
  );
});
test("server snapshot time, not device clock, determines freshness", () => {
  const before = {
    code: "A",
    createdAt: 1,
    status: "playing",
    players: [{ id: "a", bets: [bet] }],
  };
  const after = {
    ...before,
    snapshotAt: 10001,
    lastRoll: roll([outcome("p", "win", 500, 500)]),
  };
  assert.ok(freshMobileSettlement(before, after, "a", 999999999));
});
