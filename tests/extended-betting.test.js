import test from "node:test";
import assert from "node:assert/strict";
import * as game from "../src/game.js";
import { validBetChoices } from "../src/bet-options.js";
import { RoomHub } from "../src/hub.js";

function table(mode = "craps") {
  const state = game.createState("RULES");
  const player = game.join(state, "Alice");
  game.configure(state, player.id, { mode, rollCooldownSeconds: 0 });
  game.start(state, player.id);
  return { state, player };
}
function roll(state, dice) {
  // Rules fixture: skip visual physics, resolve the same authoritative roll path.
  state.rolling = true;
  return game.finishRoll(state, dice);
}
const diceFor = (n) => (n <= 7 ? [1, n - 1] : [6, n - 6]);
const rowFor = (state, player, id) =>
  game.catalogue(state, player).find((row) => row.id === id);

test("catalogue and settlement agree for every buy number in both modes", () => {
  for (const mode of ["craps", "crapless"]) {
    for (const n of mode === "crapless" ? game.ALL_POINTS : game.POINTS) {
      const { state, player } = table(mode);
      const row = rowFor(state, player, `buy-${n}`);
      const amount = row.minimum;
      assert(validBetChoices(row, amount, player).valid);
      game.place(state, player.id, row.id, amount);
      roll(state, diceFor(n)); // off on come-out
      assert.equal(player.bank, 100000 - amount);
      assert.equal(player.bets[0].amount, amount);
      const result = roll(state, diceFor(n));
      const profit = (amount * 6) / game.WAYS[n] - amount * 0.05;
      assert.equal(player.bank, 100000 - amount + profit);
      assert.equal(result.events[0].bets[0].delta, profit);
      assert.equal(player.bets[0].amount, amount);
      game.remove(state, player.id, player.bets[0].id);
      assert.equal(player.bank, 100000 + profit);
      game.place(state, player.id, row.id, amount);
      roll(state, [2, 2]);
      roll(state, [3, 4]);
      assert.equal(player.bets.length, 0);
      assert.equal(player.bank, 100000 + profit - amount);
    }
  }
});

test("all six lay numbers pay inverse true odds less win commission, always working", () => {
  const payouts = {
    4: "1:2",
    5: "2:3",
    6: "5:6",
    8: "5:6",
    9: "2:3",
    10: "1:2",
  };
  for (const n of game.POINTS) {
    const { state, player } = table();
    const row = rowFor(state, player, `lay-${n}`);
    assert.equal(row.payout.split(" · ")[0], payouts[n]);
    const amount = row.minimum;
    game.place(state, player.id, row.id, amount);
    roll(state, [3, 4]); // come-out seven wins, unlike Buy
    const profit = ((amount * game.WAYS[n]) / 6) * 0.95;
    assert.equal(player.bank, 100000 - amount + profit);
    assert.equal(player.bets.length, 1);
    roll(state, diceFor(n)); // come-out chosen number loses
    assert.equal(player.bets.length, 0);
    assert.equal(player.bank, 100000 - amount + profit);
  }
  const { state, player } = table("crapless");
  assert(
    !game.catalogue(state, player).some((row) => row.id.startsWith("lay-")),
  );
  assert.throws(() => game.place(state, player.id, "lay-4", 600), /available/);
});

test("Pass and Don't odds show reduced reciprocal payouts and settle exact legal amounts", () => {
  const expected = {
    4: ["2:1", "1:2"],
    5: ["3:2", "2:3"],
    6: ["6:5", "5:6"],
    8: ["6:5", "5:6"],
    9: ["3:2", "2:3"],
    10: ["2:1", "1:2"],
  };
  for (const n of game.POINTS)
    for (const [index, type] of ["pass", "dont"].entries()) {
      const { state, player } = table();
      game.place(state, player.id, type, 500);
      roll(state, diceFor(n));
      const parent = player.bets[0];
      const row = rowFor(state, player, `odds:${parent.id}`);
      assert.equal(row.payout, expected[n][index]);
      const amount = row.minimum;
      game.place(state, player.id, row.id, amount);
      roll(state, index ? [3, 4] : diceFor(n));
      const profit = amount * (index ? game.WAYS[n] / 6 : 6 / game.WAYS[n]);
      assert.equal(player.bank, 100500 + profit);
      assert.equal(player.bets.length, 0);
    }
});

test("all 21 unordered hop combinations resolve independently of totals in both modes", () => {
  for (const mode of ["craps", "crapless"]) {
    const initial = table(mode);
    const rows = game
      .catalogue(initial.state, initial.player)
      .filter((row) => row.id.startsWith("hop-"));
    assert.equal(rows.length, 21);
    for (const row of rows) {
      const [, first, second] = row.id.split("-").map(Number);
      for (const dice of [
        [first, second],
        [second, first],
      ]) {
        const { state, player } = table(mode);
        game.place(state, player.id, row.id, 500);
        roll(state, dice);
        assert.equal(player.bank, 100000 + 500 * (first === second ? 30 : 15));
        assert.equal(player.bets.length, 0);
      }
    }
    const { state, player } = table(mode);
    game.place(state, player.id, "hop-1-5", 500);
    game.place(state, player.id, "hard-6", 500);
    roll(state, [2, 4]); // same total is not same dice; hardway stays off
    assert.equal(player.bank, 99000);
    assert.equal(player.bets[0].type, "hard-6");
    assert.throws(() => game.place(state, player.id, "hop-5-1", 500));
  }
});

test("bonus cycles persist across point hits, pay once, prevent late entry and reset on every seven", () => {
  for (const mode of ["craps", "crapless"]) {
    const { state, player } = table(mode);
    for (const id of Object.keys(game.BONUS_NUMBERS))
      game.place(state, player.id, id, 500);
    roll(state, [1, 1]);
    assert.deepEqual(state.bonus.hits, [2]);
    assert(player.bets.every((bet) => game.betRemovalLock(bet)));
    assert.throws(
      () => game.remove(state, player.id, player.bets[0].id),
      /Locked until bonus resolves/,
    );
    assert.throws(
      () => game.place(state, player.id, "bonus-all", 500),
      /Enter bonus bets/,
    );
    // Include repeats and a made point: neither restarts a bonus cycle.
    for (const n of [3, 4, 4, 5, 6]) roll(state, diceFor(n));
    assert.equal(player.bank, 100000 - 1500 + 17500);
    assert.deepEqual(player.bets.map((bet) => bet.type).sort(), [
      "bonus-all",
      "bonus-tall",
    ]);
    for (const n of [8, 9, 10, 11, 12]) roll(state, diceFor(n));
    assert.equal(player.bank, 221500);
    assert.equal(player.bets.length, 0);
    assert.throws(
      () => game.place(state, player.id, "bonus-small", 500),
      /Enter bonus bets/,
    );
    roll(state, [3, 4]);
    assert.deepEqual(state.bonus.hits, []);
    assert.equal(rowFor(state, player, "bonus-small").available, true);
    game.place(state, player.id, "bonus-small", 500);
    roll(state, [3, 4]); // natural seven is a bonus loss as well
    assert.deepEqual(state.bonus.hits, []);
    assert.equal(player.bets.length, 0);
  }
});

test("direct opposition is symmetric and atomic, while separate casino hedges remain allowed", () => {
  for (const [first, second] of [
    ["pass", "dont"],
    ["dont", "pass"],
    ["place-4", "lay-4"],
    ["lay-4", "place-4"],
    ["buy-10", "lay-10"],
    ["lay-10", "buy-10"],
  ]) {
    const { state, player } = table();
    game.place(state, player.id, first, rowFor(state, player, first).minimum);
    const before = game.snapshot(state);
    const row = rowFor(state, player, second);
    assert.equal(row.available, false);
    assert.match(validBetChoices(row, row.minimum, player).reason, /opposing/);
    assert.throws(
      () => game.place(state, player.id, second, row.minimum),
      /opposing/,
    );
    assert.deepEqual(state, before);
    game.remove(state, player.id, player.bets[0].id);
    assert(rowFor(state, player, second).available);
  }
  for (const [first, second] of [
    ["come", "dontcome"],
    ["dontcome", "come"],
  ]) {
    const { state, player } = table();
    roll(state, [2, 2]);
    game.place(state, player.id, first, 500);
    assert.throws(() => game.place(state, player.id, second, 500), /opposing/);
    roll(state, [3, 3]);
    game.place(state, player.id, second, 500); // traveled bet is a different contract
  }
  const { state, player } = table();
  for (const id of [
    "pass",
    "lay-4",
    "field",
    "hard-6",
    "prop-7",
    "hop-3-4",
    "bonus-all",
    "place-6",
    "buy-6",
  ])
    game.place(state, player.id, id, rowFor(state, player, id).minimum);
  assert.equal(player.bets.length, 9);
});

test("take-down refunds each eligible wager and linked odds without releasing line contracts", () => {
  for (const mode of ["craps", "crapless"]) {
    const { state, player } = table(mode);
    for (const row of game
      .catalogue(state, player)
      .filter((row) => row.available)) {
      game.place(state, player.id, row.id, row.minimum);
      assert.equal(game.betRemovalLock(player.bets[0], player.bets), "");
      game.remove(state, player.id, player.bets[0].id);
      assert.equal(player.bank, 100000);
    }
    game.place(state, player.id, "pass", 500);
    roll(state, [2, 2]);
    const line = player.bets[0];
    const odds = rowFor(state, player, `odds:${line.id}`);
    game.place(state, player.id, odds.id, odds.minimum);
    assert(game.betRemovalLock(line, player.bets));
    assert.throws(
      () => game.remove(state, player.id, line.id),
      /Locked until its point resolves/,
    );
    game.remove(
      state,
      player.id,
      player.bets.find((bet) => bet.type === "odds").id,
    );
    assert.equal(player.bank, 99500);
  }
  const { state, player } = table();
  game.place(state, player.id, "dont", 500);
  roll(state, [2, 2]);
  const line = player.bets[0];
  const odds = rowFor(state, player, `odds:${line.id}`);
  game.place(state, player.id, odds.id, odds.minimum);
  game.remove(state, player.id, line.id);
  assert.equal(player.bank, 100000);
  assert.equal(player.bets.length, 0);
});

test("each player must take down their own Buy bets before removing an open Pass Line", () => {
  for (const mode of ["craps", "crapless"]) {
    const { state, player } = table(mode);
    const guest = game.join(state, "Guest");
    game.place(state, guest.id, "buy-5", 600);
    game.place(state, player.id, "pass", 2500);
    const pass = player.bets[0].id;
    game.place(state, player.id, "buy-4", 500);
    game.place(state, player.id, "buy-10", 500);
    const firstBuy = player.bets[1].id;
    const secondBuy = player.bets[2].id;
    const bank = player.bank;
    assert.throws(() => game.remove(state, player.id, pass), /Buy bets first/);
    assert.equal(player.bank, bank);
    game.remove(state, player.id, firstBuy);
    assert.throws(() => game.remove(state, player.id, pass), /Buy bets first/);
    game.remove(state, player.id, secondBuy);
    game.remove(state, player.id, pass);
    assert.equal(player.bank, 100000);
    assert.equal(guest.bets.length, 1);
  }
});

test("bonus progress and contract removal rules survive wire snapshots and authenticated reconnect", (t) => {
  const hub = new RoomHub("RULES");
  t.after(() => hub.close());
  const messages = [];
  hub.connect("one", (message) => messages.push(message));
  hub.receive("one", { type: "join", name: "Alice", code: "RULES" });
  const welcome = messages.find((message) => message.type === "welcome");
  hub.receive("one", { type: "configure", config: { rollCooldownSeconds: 0 } });
  hub.receive("one", { type: "start" });
  hub.receive("one", { type: "bet", betId: "bonus-all", amount: 500 });
  roll(hub.state, [1, 1]);
  const saved = JSON.parse(JSON.stringify(game.snapshot(hub.state)));
  assert.deepEqual(saved.bonus.hits, [2]);
  assert.equal(saved.players[0].bets[0].started, true);
  assert.throws(
    () => game.remove(saved, welcome.playerId, saved.players[0].bets[0].id),
    /Locked until bonus resolves/,
  );
  hub.disconnect("one");
  const reconnected = [];
  hub.connect("two", (message) => reconnected.push(message));
  hub.receive("two", { type: "join", code: "RULES", token: welcome.token });
  assert.equal(hub.state.players.length, 1);
  assert.deepEqual(
    reconnected.filter((message) => message.type === "state").at(-1).state.bonus
      .hits,
    [2],
  );
  roll(hub.state, [3, 4]);
  hub.receive("two", { type: "bet", betId: "buy-4", amount: 500 });
  const buy = hub.state.players[0].bets.find((bet) => bet.type === "buy-4");
  hub.receive("two", { type: "remove", betId: buy.id });
  assert.equal(hub.state.players[0].bank, 99500);
  assert.equal(hub.state.players[0].bets.length, 0);
});
