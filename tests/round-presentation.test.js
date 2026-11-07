import test from "node:test";
import assert from "node:assert/strict";
import {
  planOutcomeTour,
  sampleOutcomeTour,
  slotForPlayer,
} from "../src/round-presentation.js";
import {
  presentationFlows,
  planChipFlows,
  visualChipAmount,
  bankRoute,
  sampleChipFlow,
  resolveOutcomePresentation,
} from "../src/chip-flow.js";
import * as game from "../src/game.js";

function fixture(count = 3, deadline = 11000) {
  return {
    code: "ROUND",
    createdAt: 1,
    status: "playing",
    rolling: false,
    nextRollAt: deadline,
    throw: { settledAt: 700 },
    players: Array.from({ length: count }, (_, seat) => ({
      id: `p${seat}`,
      name: `Player ${seat}`,
      seat,
      bank: 10500,
      bets: [],
    })),
    lastRoll: {
      id: "r1",
      at: 1000,
      events: Array.from({ length: count }, (_, seat) => ({
        playerId: `p${seat}`,
        name: `Player ${seat}`,
        delta: 500,
        bets: [
          {
            betId: `b${seat}`,
            label: "Pass line",
            amount: 500,
            delta: 500,
            result: "win",
            standing: false,
            sourceBet: {
              id: `b${seat}`,
              type: "pass",
              point: 6,
              amount: 500,
              parent: null,
            },
          },
        ],
      })),
    },
  };
}
function planned(count, deadline) {
  const state = fixture(count, deadline);
  state.lastRoll.presentation = planOutcomeTour(state);
  return state;
}

function actionFixture(
  values,
  labels = values.map(() => "Pass line"),
  id = "r1",
) {
  const state = fixture(values.length);
  state.lastRoll.id = id;
  values.forEach((delta, index) => {
    state.players[index].bank = 1000000;
    const event = state.lastRoll.events[index];
    event.delta = delta;
    Object.assign(event.bets[0], {
      delta,
      amount: Math.abs(delta),
      result: delta > 0 ? "win" : "lose",
      label: labels[index],
    });
    event.bets[0].sourceBet.type = labels[index];
  });
  return state;
}

test("fixed window keeps editorial groups disjoint and never extends its deadline", () => {
  const state = fixture(12),
    before = structuredClone(state),
    plan = planOutcomeTour(state);
  assert.deepEqual(state, before);
  assert.equal(plan.startAt, 2300);
  assert(plan.slots.length <= 5);
  const covered = plan.slots.flatMap((slot) => slot.playerIds);
  assert.equal(new Set(covered).size, 12);
  assert.equal(covered.length, 12);
  assert(plan.endAt <= state.nextRollAt);
  assert(Object.isFrozen(plan) && Object.isFrozen(plan.transfers[0].from.bet));
  assert.equal(new Set(plan.transfers.map((flow) => flow.id)).size, 12);
  for (const flow of plan.transfers) {
    const slot = slotForPlayer(plan, flow.playerId);
    assert.equal(flow.startAt, slot.transferAt);
    assert.equal(flow.duration, 1150);
    assert(flow.startAt + flow.duration <= slot.endAt);
  }
  assert.deepEqual(plan, planOutcomeTour(state));
  assert.equal(sampleOutcomeTour(plan, 2300).slot, plan.slots[0]);
  assert.equal(sampleOutcomeTour(plan, plan.endAt), null);
});

test("short fixed windows use one concurrent batch; zero preserves immediate transfers without a camera tour", () => {
  const short = planOutcomeTour(fixture(12, 2000));
  assert.equal(short.slots.length, 1);
  assert.equal(short.slots[0].kind, "group");
  assert.equal(short.endAt, 2000);
  assert(short.transfers.every((flow) => flow.startAt + flow.duration <= 2000));
  const zero = planOutcomeTour(fixture(2, 1000));
  assert.equal(zero.mode, "immediate");
  assert.deepEqual(zero.slots, []);
  assert.equal(zero.transfers[0].startAt, 1090);
  assert.equal(zero.transfers[0].duration, 1150);
  assert.equal(sampleOutcomeTour(zero, 1200), null);
  const complete = planOutcomeTour(fixture(1), {
    mode: "complete",
    slotMs: 12000,
  });
  assert.equal(complete.slots.length, 1);
  assert(complete.endAt > 11000);
  assert.throws(() => planOutcomeTour(fixture(), { slotMs: 0 }), /Invalid/);
});

test("all genuine settlements retain their amounts, routes and labels including mixed net zero", () => {
  const state = fixture(1);
  const event = state.lastRoll.events[0];
  event.delta = 0;
  event.bets = [
    {
      betId: "pass",
      label: "Pass",
      amount: 500,
      delta: 500,
      result: "win",
      sourceBet: { id: "pass", type: "pass", point: 6 },
    },
    {
      betId: "field",
      label: "Field",
      amount: 500,
      delta: -500,
      result: "lose",
      sourceBet: { id: "field", type: "field" },
    },
    {
      betId: "place",
      label: "Place 6",
      amount: 600,
      delta: 700,
      result: "win",
      standing: true,
      sourceBet: { id: "place", type: "place-6" },
    },
    {
      betId: "odds",
      label: "Come odds",
      amount: 600,
      delta: 0,
      result: "push",
      sourceBet: { id: "odds", type: "odds", point: 8, parentType: "come" },
    },
  ];
  const plan = planOutcomeTour(state);
  assert.equal(plan.slots[0].outcome, "mixed");
  assert.equal(plan.slots[0].delta, 0);
  assert.deepEqual(plan.slots[0].betLabels, [
    "Pass",
    "Field",
    "Place 6",
    "Come odds",
  ]);
  assert.deepEqual(
    plan.transfers.map((flow) => [flow.kind, flow.amount, flow.sourceAmount]),
    [
      ["win", 1000, 500],
      ["loss", 500, 500],
      ["win", 700, 0],
      ["return", 600, 600],
    ],
  );
  assert.equal(plan.transfers[1].to.kind, "dealer");
  assert.equal(plan.transfers[3].from.bet.parentType, "come");
});

test("late viewers seek only current/future transfers and live deadline changes stop them", () => {
  const state = actionFixture(
    [-50000, 900, 800, 700],
    ["Pass", "Place 6", "Field", "Hard 8"],
  );
  state.lastRoll.presentation = planOutcomeTour(state);
  const late = presentationFlows(state, 8000);
  assert(late.length > 0);
  assert(late.every((flow) => flow.startAt + flow.duration > 8000));
  assert.deepEqual(
    late,
    presentationFlows(JSON.parse(JSON.stringify(state)), 8000),
  );
  state.nextRollAt = 8000;
  assert(presentationFlows(state, 7990).every((flow) => flow.cutAt === 8000));
  assert.deepEqual(presentationFlows(state, 8000), []);
  assert.equal(
    sampleOutcomeTour(state.lastRoll.presentation, 8000, {
      deadline: state.nextRollAt,
    }),
    null,
  );
  const flow = late[0];
  flow.cutAt = 8000;
  assert.equal(sampleChipFlow(flow, 8000).done, true);
  assert.equal(
    visualChipAmount(10500, bankRoute(flow.playerId), [flow], 8000),
    10500,
  );
  state.rolling = true;
  assert.deepEqual(presentationFlows(state, 1000), []);
});

test("completed planned payouts do not become phantom re-ups in a delayed state diff", () => {
  const next = planned(1),
    previous = fixture(1);
  previous.lastRoll = null;
  previous.players[0].bank = 9500;
  previous.players[0].bets = [
    { id: "b0", type: "pass", point: 6, amount: 500 },
  ];
  assert.deepEqual(planChipFlows(previous, next, { now: 8000 }), []);
});

test("game captures routes before mutating bets and preserves fixed cooldown/ledger values", (t) => {
  t.mock.method(Date, "now", () => 1000);
  const state = game.createState(),
    player = game.join(state, "Alice");
  game.configure(state, player.id, { rollCooldownSeconds: 0 });
  game.start(state, player.id);
  game.place(state, player.id, "pass", 500);
  game.place(state, player.id, "field", 500);
  game.beginRoll(state, player.id);
  game.setRollCooldown(state, player.id, 10);
  game.finishRoll(state, [3, 4]);
  assert.equal(player.bank, 100000);
  assert.equal(state.lastRoll.events[0].delta, 0);
  assert.equal(state.nextRollAt, 11000);
  const plan = state.lastRoll.presentation;
  assert.equal(state.rolls[0].presentation, undefined);
  assert.equal(state.rolls[0].id, state.lastRoll.id);
  assert.deepEqual(state.rolls[0].events, state.lastRoll.events);
  assert(
    plan.transfers.every((flow) => flow.from.bet.id && flow.from.bet.type),
  );
  assert.equal(plan.transfers.length, 2);
  game.setRollCooldown(state, player.id, 0);
  assert.equal(state.nextRollAt, 1000);
  assert.deepEqual(presentationFlows(state, 1000), []);
});

test("a standout winner leads a matching pair and the remaining table", () => {
  const state = actionFixture([50000, 10000, 10000, ...Array(9).fill(2500)]);
  const plan = planOutcomeTour(state);
  assert.deepEqual(
    plan.slots.map((slot) => slot.style),
    ["hero", "pair", "overview"],
  );
  assert.equal(plan.slots[0].playerId, "p0");
  assert.equal(plan.slots[1].reason, "shared-win");
  assert.deepEqual(plan.slots[1].playerIds, ["p1", "p2"]);
  assert.equal(plan.slots[2].playerIds.length, 9);
  assert.equal(plan.slots[0].focus.region, "left");
});

test("a large loss can lead three different wins individually without seat-order directing", () => {
  const state = actionFixture(
    [-50000, 900, 800, 700],
    ["Pass", "Place 6", "Field", "Hard 8"],
  );
  const plan = planOutcomeTour(state);
  assert.equal(plan.slots[0].reason, "standout");
  assert.equal(plan.slots[0].outcome, "lose");
  assert.equal(plan.slots.length, 4);
  assert(plan.slots.every((slot) => slot.kind === "player"));
  const lastSeatHero = actionFixture([...Array(7).fill(500), 50000]);
  assert.equal(planOutcomeTour(lastSeatHero).slots[0].playerId, "p7");
});

test("balanced rounds vary coherently between shared overviews and spatial clusters", () => {
  const compositions = new Set();
  for (let index = 0; index < 30; index++) {
    const state = actionFixture(
      Array(12).fill(500),
      undefined,
      `balanced-${index}`,
    );
    const before = structuredClone(state),
      plan = planOutcomeTour(state);
    assert.deepEqual(plan, planOutcomeTour(JSON.parse(JSON.stringify(state))));
    assert.deepEqual(state, before);
    compositions.add(plan.slots.map((slot) => slot.reason).join(","));
    const ids = plan.slots.flatMap((slot) => slot.playerIds);
    assert.equal(ids.length, 12);
    assert.equal(new Set(ids).size, 12);
    assert(plan.slots.length <= 5 && plan.endAt <= state.nextRollAt);
    assert(plan.transfers.every((flow) => flow.duration === 1150));
  }
  assert(compositions.has("overview"));
  assert(compositions.has("left,right"));
  const left = actionFixture([500, -500, 500], ["Pass", "Field", "Place 6"]);
  left.players[2].seat = 6;
  assert.equal(planOutcomeTour(left).slots[0].reason, "left");
});

test("personal bankroll and unusually large payout multiples can supply a meaningful focus", () => {
  const bust = actionFixture([-900, -2000, -2000]);
  bust.players[0].bank = 0;
  assert.equal(planOutcomeTour(bust).slots[0].playerId, "p0");
  assert.equal(planOutcomeTour(bust).slots[0].reason, "standout");
  const odds = actionFixture([30000, 50000, 50000]);
  odds.lastRoll.events[0].bets[0].amount = 1000;
  assert.equal(planOutcomeTour(odds).slots[0].playerId, "p0");
  const empty = actionFixture([0]);
  assert.deepEqual(planOutcomeTour(empty).slots, []);
});

test("tight budgets merge unshown actors instead of repeating them or shortening full flights", () => {
  const state = actionFixture([50000, 10000, 10000, ...Array(9).fill(2500)]);
  state.nextRollAt = 5300;
  const plan = planOutcomeTour(state);
  assert.equal(plan.slots.length, 2);
  assert.equal(plan.slots[0].style, "hero");
  assert.equal(plan.slots[1].reason, "overview");
  const ids = plan.slots.flatMap((slot) => slot.playerIds);
  assert.equal(ids.length, 12);
  assert.equal(new Set(ids).size, 12);
  assert(
    plan.endAt <= state.nextRollAt &&
      plan.transfers.every((flow) => flow.duration === 1150),
  );
});

test("legacy render-only resolution adds exact before-bet routes without mutating room state", () => {
  const next = fixture(1),
    previous = fixture(1);
  previous.lastRoll = null;
  const bet = {
    id: "b0",
    type: "odds",
    point: 6,
    amount: 500,
    parent: "parent",
  };
  previous.players[0].bets = [
    { id: "parent", type: "come", point: 6, amount: 500 },
    bet,
  ];
  next.lastRoll.events[0].bets[0].sourceBet = undefined;
  const before = structuredClone(next);
  const resolved = resolveOutcomePresentation(previous, next);
  assert.equal(resolved.transfers[0].from.bet.parentType, "come");
  assert.equal(resolved.transfers[0].from.bet.point, 6);
  assert.deepEqual(next, before);
  next.lastRoll.presentation = resolved;
  assert.equal(resolveOutcomePresentation(previous, next), resolved);
});
