import test from "node:test";
import assert from "node:assert/strict";
import * as game from "../src/game.js";

function table() {
  const state = game.createState("BETLOG");
  const player = game.join(state, "Alice");
  game.start(state, player.id);
  return { state, player };
}
function roll(state, player, dice) {
  game.beginRoll(state, player.id);
  return game.finishRoll(state, dice);
}

test("offsetting pass win and field loss retain both outcomes when the roll net is zero", () => {
  const { state, player } = table();
  game.place(state, player.id, "pass", 500);
  game.place(state, player.id, "field", 500);
  const [pass, field] = player.bets;
  const result = roll(state, player, [3, 4]);
  assert.equal(result.events.length, 1);
  const event = result.events[0];
  assert.equal(event.playerId, player.id);
  assert.equal(event.delta, 0);
  assert.deepEqual(event.bets, [
    {
      betId: pass.id,
      label: "Pass line",
      result: "win",
      delta: 500,
      amount: 500,
    },
    {
      betId: field.id,
      label: "Field",
      result: "lose",
      delta: -500,
      amount: 500,
    },
  ]);
  assert.equal(player.bank, 100000);
  assert.equal(player.bets.length, 0);
  assert.equal(player.stats.wins, 1);
  assert.equal(player.stats.losses, 1);
  assert.equal(player.stats.pushes, 0);
});

test("a genuine don’t-pass push on twelve is recorded as a push with zero delta", () => {
  const { state, player } = table();
  game.place(state, player.id, "dont", 500);
  const bet = player.bets[0];
  const result = roll(state, player, [6, 6]);
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].delta, 0);
  assert.deepEqual(result.events[0].bets, [
    {
      betId: bet.id,
      label: "Don’t pass",
      result: "push",
      delta: 0,
      amount: 500,
    },
  ]);
  assert.equal(player.bank, 100000);
  assert.equal(player.bets.length, 0);
  assert.equal(player.stats.pushes, 1);
  assert.equal(player.stats.wins, 0);
  assert.equal(player.stats.losses, 0);
});

test("a place win reports only its actual profit while keeping the stake on the table", () => {
  const { state, player } = table();
  roll(state, player, [2, 2]); // establish four: place bets now work
  game.place(state, player.id, "place-6", 600);
  const bet = player.bets[0];
  const result = roll(state, player, [2, 4]);
  assert.deepEqual(result.events[0].bets, [
    { betId: bet.id, label: "Place 6", result: "win", delta: 700, amount: 600 },
  ]);
  assert.equal(result.events[0].delta, 700);
  assert.equal(player.bank, 100100);
  assert.equal(player.bets[0].id, bet.id);
  assert.equal(player.bets[0].amount, 600);
  assert.equal(game.equity(player), 100700);
});

test("odds keep their original label after the parent line bet is removed", () => {
  const { state, player } = table();
  game.place(state, player.id, "pass", 500);
  roll(state, player, [2, 2]);
  const parent = player.bets[0];
  game.place(state, player.id, `odds:${parent.id}`, 600);
  const odds = player.bets.find((b) => b.type === "odds");
  const label = game.describeBet(state, player, odds).name;
  const result = roll(state, player, [2, 2]);
  const event = result.events[0];
  assert.equal(event.bets.find((b) => b.betId === odds.id).label, label);
  assert.equal(event.bets.find((b) => b.betId === odds.id).delta, 1200);
  assert.equal(
    event.delta,
    event.bets.reduce((sum, b) => sum + b.delta, 0),
  );
  assert.equal(player.bank, 101700);
});

test("unresolved traveled and off bets do not masquerade as pushes", () => {
  const { state, player } = table();
  game.place(state, player.id, "pass", 500);
  game.place(state, player.id, "place-6", 600);
  const result = roll(state, player, [2, 2]);
  assert.equal(result.events.length, 0);
  assert.equal(player.bets.length, 2);
  assert.equal(player.stats.pushes, 0);
});
