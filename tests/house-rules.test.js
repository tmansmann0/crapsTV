import assert from "node:assert/strict";
import test from "node:test";
import * as game from "../src/game.js";
import { DEFAULT_HOUSE_RULES } from "../src/house-rules.js";
import { mobilePayouts } from "../src/mobile-settlement.js";
import { sampleTableCamera } from "../src/throw-camera.js";
import { captureRoomSave, readRoomSave } from "../src/room-save.js";

function table() {
  const state = game.createState("RULES2");
  const host = game.join(state, "Host");
  return { state, host };
}

test("Second Wind starts off and is a host-only rule that survives setup and saves", () => {
  const { state, host } = table();
  const guest = game.join(state, "Guest");
  assert.deepEqual(state.config.houseRules, DEFAULT_HOUSE_RULES);
  assert.equal(state.config.houseRules.secondWindChance, 25);
  assert.throws(
    () => game.setHouseRule(state, guest.id, "secondWind", true),
    /Only the table host/,
  );
  assert.throws(
    () => game.setHouseRule(state, guest.id, "secondWindChance", 75),
    /Only the table host/,
  );
  assert.throws(
    () => game.setHouseRule(state, host.id, "unknown", true),
    /Choose a game rule/,
  );
  game.setHouseRule(state, host.id, "secondWind", true);
  for (const value of [-1, 101, 12.5, "30"])
    assert.throws(
      () => game.setHouseRule(state, host.id, "secondWindChance", value),
      /reroll chance/,
    );
  game.setHouseRule(state, host.id, "secondWindChance", 37);
  game.configure(state, host.id, { minBet: 1000 });
  assert.equal(state.config.houseRules.secondWind, true);
  const save = captureRoomSave(state, new Map([["host-token", host.id]]), []);
  const restored = () =>
    readRoomSave(JSON.stringify(save)).state.config.houseRules;
  assert.equal(restored().secondWind, true);
  assert.equal(restored().secondWindChance, 37);
  delete save.state.config.houseRules.secondWindChance;
  assert.equal(restored().secondWind, true);
  assert.equal(restored().secondWindChance, 25);
  delete save.state.config.houseRules;
  assert.deepEqual(restored(), DEFAULT_HOUSE_RULES);
});

for (const {
  name,
  enabled,
  chance,
  draws,
  finalSeed,
  result,
  announce = true,
} of [
  {
    name: "off keeps an initial seven",
    enabled: false,
    draws: [0],
    finalSeed: 0,
    result: 7,
  },
  {
    name: "ignores a non-seven",
    enabled: true,
    draws: [2],
    finalSeed: 2,
    result: 5,
  },
  {
    name: "keeps the first seven at the default 25% cutoff",
    enabled: true,
    draws: [0, 0x40000000],
    finalSeed: 0,
    result: 7,
  },
  {
    name: "replaces a seven below the default 25% cutoff",
    enabled: true,
    draws: [0, 0x3fffffff, 2],
    finalSeed: 2,
    result: 5,
  },
  {
    name: "rerolls invisibly when house announcements are off",
    enabled: true,
    chance: 60,
    draws: [0, 0x7fffffff, 2],
    finalSeed: 2,
    result: 5,
    announce: false,
  },
  {
    name: "keeps the replacement when it is another seven",
    enabled: true,
    chance: 100,
    draws: [0, 0xffffffff, 1],
    finalSeed: 1,
    result: 7,
  },
  {
    name: "keeps an initial seven when configured to 0%",
    enabled: true,
    chance: 0,
    draws: [0],
    finalSeed: 0,
    result: 7,
  },
]) {
  test(`Second Wind ${name}`, (t) => {
    const { state, host } = table();
    game.setHouseRule(state, host.id, "secondWind", enabled);
    if (chance !== undefined)
      game.setHouseRule(state, host.id, "secondWindChance", chance);
    game.setHouseRule(state, host.id, "announce", announce);
    game.start(state, host.id);
    state.nextRollAt = 0;
    const original = crypto.getRandomValues.bind(crypto);
    const expected = [...draws];
    t.mock.method(crypto, "getRandomValues", (buffer) => {
      if (!(buffer instanceof Uint32Array) || buffer.length !== 1)
        return original(buffer);
      assert(expected.length, "Unexpected extra random draw");
      buffer[0] = expected.shift();
      return buffer;
    });
    const flight = game.beginRoll(state, host.id, { x: 0, power: 0.7 });
    assert.equal(flight.seed, finalSeed);
    assert.equal(flight.secondWind === true, announce && draws.length === 3);
    assert.equal(state.throw, flight);
    assert.equal(state.rolls.length, 0);
    assert.throws(
      () => game.setHouseRule(state, host.id, "secondWindChance", 50),
      /Wait for the dice/,
    );
    game.finishRoll(state);
    assert.equal(state.rolls.length, 1);
    assert.equal(state.lastRoll.total, result);
    assert.equal(
      state.lastRoll.houseRulesTriggered?.includes("secondWind") ?? false,
      announce && draws.length === 3,
    );
    assert.equal(expected.length, 0);
  });
}

function roll(state, dice) {
  state.rolling = true;
  return game.finishRoll(state, dice);
}

test("hard points, natural sevens, and cashback modify only the eligible Pass Line", () => {
  const { state, host } = table();
  const guest = game.join(state, "Guest");
  for (const rule of ["hardPoint", "luckySeven", "crapsCashback"])
    game.setHouseRule(state, host.id, rule, true);
  game.start(state, host.id);

  game.place(state, host.id, "pass", 2000);
  roll(state, [1, 3]);
  game.place(state, host.id, `odds:${host.bets[0].id}`, 500);
  let result = roll(state, [2, 2]);
  assert.deepEqual(result.houseRulesTriggered, ["hardPoint"]);
  assert.deepEqual(
    result.events[0].bets.map((bet) => bet.delta),
    [2500, 1000],
  );

  game.place(state, host.id, "pass", 500);
  game.place(state, guest.id, "dont", 500);
  result = roll(state, [3, 4]);
  assert.deepEqual(result.houseRulesTriggered, ["luckySeven"]);
  assert.deepEqual(
    result.events.map((event) => event.delta),
    [1000, -500],
  );

  game.place(state, host.id, "pass", 500);
  game.place(state, guest.id, "dont", 500);
  const before = game.snapshot(state);
  result = roll(state, [1, 1]);
  assert.deepEqual(result.houseRulesTriggered, ["crapsCashback"]);
  assert.deepEqual(
    result.events.map((event) => event.delta),
    [-250, 500],
  );
  assert.equal(result.events[0].bets[0].returnedStake, 250);
  assert.deepEqual(
    result.presentation.transfers
      .filter((transfer) => transfer.playerId === host.id)
      .map(({ kind, amount, from }) => [kind, amount, from.kind]),
    [
      ["loss", 500, "bet"],
      ["return", 250, "dealer"],
    ],
  );
  assert.equal(
    mobilePayouts(result, before.players[0].bets, host.id)[0].total,
    250,
  );
});

test("Craps Cashback is inactive in Crapless", () => {
  const { state, host } = table();
  game.configure(state, host.id, { mode: "crapless" });
  game.setHouseRule(state, host.id, "crapsCashback", true);
  game.start(state, host.id);
  game.place(state, host.id, "pass", 500);
  const result = roll(state, [6, 6]);
  assert.equal(state.point, 12);
  assert.equal(host.bets[0].point, 12);
  assert.equal(result.houseRulesTriggered, undefined);
});

test("custom house rule amounts are used for settlement and recorded with the outcome", () => {
  const { state, host } = table();
  for (const rule of ["hardPoint", "hotHand", "luckySeven", "crapsCashback"])
    game.setHouseRule(state, host.id, rule, true);
  game.setHouseRule(state, host.id, "hardPointPayout", 150);
  game.setHouseRule(state, host.id, "hotHandBonus", 40);
  game.setHouseRule(state, host.id, "luckySevenPayout", 225);
  game.setHouseRule(state, host.id, "crapsCashbackPercent", 75);
  game.start(state, host.id);

  const bet = () => game.place(state, host.id, "pass", 500);
  bet();
  let result = roll(state, [3, 4]);
  assert.equal(result.events[0].delta, 1125);
  assert.deepEqual(result.houseRuleValues, { luckySeven: 225 });
  game.setHouseRule(state, host.id, "luckySevenPayout", 300);
  assert.equal(result.houseRuleValues.luckySeven, 225);

  bet();
  result = roll(state, [1, 1]);
  assert.equal(result.events[0].bets[0].returnedStake, 375);
  assert.deepEqual(result.houseRuleValues, { crapsCashback: 75 });

  for (let made = 0; made < 3; made++) {
    bet();
    roll(state, [1, 3]);
    result = roll(state, [2, 2]);
  }
  assert.equal(result.events[0].delta, 1050);
  assert.deepEqual(result.houseRuleValues, { hardPoint: 150, hotHand: 40 });
});

test("Hot Hand uses net roll profit and Jackpot pays each qualifying player once", () => {
  const { state, host } = table();
  const guest = game.join(state, "Guest");
  const spectator = game.join(state, "Player without a qualifying bet");
  for (const rule of ["hotHand", "tableJackpot", "announce"])
    game.setHouseRule(state, host.id, rule, true);
  assert.throws(
    () => game.setHouseRule(state, host.id, "jackpotBonus", 0),
    /jackpot bonus/,
  );
  assert.throws(
    () => game.setHouseRule(state, guest.id, "jackpotBonus", 4000),
    /table host/,
  );
  game.setHouseRule(state, host.id, "jackpotBonus", 4000);
  game.start(state, host.id);
  for (const player of [guest, host]) {
    game.place(state, player.id, "pass", 500);
    roll(state, [1, 3]);
    assert.equal(roll(state, [1, 3]).houseRulesTriggered, undefined);
  }

  game.place(state, host.id, "pass", 500);
  game.place(state, guest.id, "dont", 500);
  roll(state, [2, 3]);
  game.place(state, host.id, "place-5", 500);
  game.place(state, host.id, "field", 500);
  let result = roll(state, [2, 3]);
  assert.deepEqual(result.houseRulesTriggered, ["hotHand"]);
  assert.equal(result.events[0].bets.find((bet) => bet.award).delta, 175);
  assert.equal(result.events[1].delta, -500);

  const save = readRoomSave(
    JSON.stringify(captureRoomSave(state, new Map([["token", host.id]]), [])),
  );
  const resumed = save.state;
  const [resumedHost, resumedGuest] = resumed.players;
  assert.equal(resumed.config.houseRules.jackpotBonus, 4000);
  assert.equal(resumed.config.houseRules.announce, true);
  assert.deepEqual(resumed.houseHand.points, [4, 5]);
  delete resumed.pausedAt;
  game.place(resumed, resumedHost.id, "pass", 500);
  roll(resumed, [2, 4]);
  result = roll(resumed, [2, 4]);
  assert.deepEqual(result.houseRulesTriggered, ["tableJackpot"]);
  assert.deepEqual(
    result.events.map((event) => [event.playerId, event.delta]),
    [
      [resumedHost.id, 4500],
      [resumedGuest.id, 4000],
    ],
  );
  assert(!result.events.some((event) => event.playerId === spectator.id));
  assert(
    result.presentation.transfers.some(
      (transfer) =>
        transfer.playerId === resumedGuest.id &&
        transfer.from.kind === "dealer" &&
        transfer.amount === 4000,
    ),
  );
  assert.equal(mobilePayouts(result, [], resumedGuest.id)[0].total, 4000);
  const stakeTransfer = result.presentation.transfers.find(
    (transfer) => transfer.from.kind === "bet",
  );
  const camera = sampleTableCamera({
    state: resumed,
    now: stakeTransfer.startAt + 250,
  });
  assert.match(camera.phase, /^outcome-/);
  assert(camera.position.every(Number.isFinite));

  roll(resumed, [3, 5]);
  assert.equal(roll(resumed, [3, 5]).houseRulesTriggered, undefined);
  roll(resumed, [3, 5]);
  roll(resumed, [3, 4]);
  assert.equal(resumed.houseHand.made, 0);
  assert.deepEqual(resumed.houseHand.points, []);
});

test("only the shooter can voluntarily pass after a point and the next hand starts fresh", () => {
  const { state, host } = table();
  const guest = game.join(state, "Guest");
  game.setHouseRule(state, host.id, "passTheDice", true);
  game.start(state, host.id);
  assert.throws(() => game.passDice(state, host.id), /after making/);
  roll(state, [2, 2]);
  game.place(state, host.id, "come", 500);
  roll(state, [2, 4]);
  roll(state, [2, 2]);
  assert.throws(() => game.passDice(state, guest.id), /after making/);
  state.aim = { playerId: host.id, active: true };
  game.passDice(state, host.id);
  assert.equal(state.aim, null);
  assert.equal(state.shooterId, guest.id);
  assert.equal(state.houseHand.made, 0);
  assert.equal(host.bets[0].point, 6);
  assert.equal(state.log[0].type, "house-pass-the-dice");
  assert.throws(() => game.passDice(state, guest.id), /after making/);
});
