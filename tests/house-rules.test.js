import assert from "node:assert/strict";
import test from "node:test";
import * as game from "../src/game.js";
import { DEFAULT_HOUSE_RULES, houseRuleOffer } from "../src/house-rules.js";
import {
  CHANCE_HOP_BUCKET,
  createChanceDiceHops,
} from "../src/house-rule-dice-motion.js";
import { suspensionPoses } from "../src/house-rule-fling.js";
import {
  createDiceSuspension,
  simulateChanceDrop,
} from "../src/house-rule-suspension.js";
import { upperDieFace } from "../src/throw-motion.js";
import { RoomHub } from "../src/hub.js";
import { mobilePayouts } from "../src/mobile-settlement.js";
import { sampleTableCamera } from "../src/throw-camera.js";
import { captureRoomSave, readRoomSave } from "../src/room-save.js";

function chanceDraw(first, second) {
  const pair = (first - 1) * 6 + (second - 1);
  return Math.floor(((pair + 0.5) * 0x100000000) / 36);
}

// The two launches share the same seed while their pip orientations vary.
const hopDraw = {
  "1,1": 1289983039,
  "2,3": 193871659,
  "2,4": 178958579,
  "5,6": 589068279,
  "6,6": 946982199,
};

function table() {
  const state = game.createState("RULES2");
  const host = game.join(state, "Host");
  return { state, host };
}

test("Second Wind starts off and is a host-only rule that survives setup and saves", () => {
  const { state, host } = table();
  const guest = game.join(state, "Guest");
  assert.deepEqual(state.config.houseRules, DEFAULT_HOUSE_RULES);
  assert.equal(state.config.houseRules.secondWindTarget, 5);
  assert.throws(
    () => game.setHouseRule(state, guest.id, "secondWind", true),
    /Only the table host/,
  );
  assert.throws(
    () => game.setHouseRule(state, guest.id, "secondWindTarget", 75),
    /Only the table host/,
  );
  assert.throws(
    () => game.setHouseRule(state, host.id, "unknown", true),
    /Choose a game rule/,
  );
  game.setHouseRule(state, host.id, "secondWind", true);
  for (const value of [0, 13, 5.5, "5"])
    assert.throws(
      () => game.setHouseRule(state, host.id, "secondWindTarget", value),
      /trigger total/,
    );
  game.setHouseRule(state, host.id, "secondWindTarget", 7);
  game.configure(state, host.id, { minBet: 1000 });
  assert.equal(state.config.houseRules.secondWind, true);
  const save = captureRoomSave(state, new Map([["host-token", host.id]]), []);
  const restored = () =>
    readRoomSave(JSON.stringify(save)).state.config.houseRules;
  assert.equal(restored().secondWind, true);
  assert.equal(restored().secondWindTarget, 7);
  delete save.state.config.houseRules.secondWindTarget;
  assert.equal(restored().secondWind, true);
  assert.equal(restored().secondWindTarget, 5);
  save.state.config.houseRules.secondWindChance = 37;
  assert.equal(restored().secondWindTarget, 6);
  assert.equal(restored().secondWindChance, undefined);
  delete save.state.config.houseRules;
  assert.deepEqual(restored(), DEFAULT_HOUSE_RULES);
});

for (const {
  name,
  enabled,
  target,
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
    name: "keeps the first seven above the default total of five",
    enabled: true,
    draws: [0, hopDraw["2,4"]],
    finalSeed: 0,
    result: 7,
  },
  {
    name: "replaces a seven at the default total of five",
    enabled: true,
    draws: [0, hopDraw["2,3"], 2],
    finalSeed: 2,
    result: 5,
  },
  {
    name: "rerolls invisibly when house announcements are off",
    enabled: true,
    target: 7,
    draws: [0, chanceDraw(4, 3), 2],
    finalSeed: 2,
    result: 5,
    announce: false,
  },
  {
    name: "keeps the replacement when it is another seven",
    enabled: true,
    target: 12,
    draws: [0, hopDraw["6,6"], 1],
    finalSeed: 1,
    result: 7,
  },
  {
    name: "keeps an initial seven when the trigger is set to Never",
    enabled: true,
    target: 1,
    draws: [0, hopDraw["1,1"]],
    finalSeed: 0,
    result: 7,
  },
]) {
  test(`Second Wind ${name}`, (t) => {
    const { state, host } = table();
    game.setHouseRule(state, host.id, "secondWind", enabled);
    if (target !== undefined)
      game.setHouseRule(state, host.id, "secondWindTarget", target);
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
      () => game.setHouseRule(state, host.id, "secondWindTarget", 50),
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

function quote(state, rule) {
  const rules = state.config.houseRules;
  return {
    ...houseRuleOffer(rules, rule),
    value: rules.luckySevenPayout,
    completedRolls: state.rolls.length,
  };
}

test("paid rules use chips, affect their buyer only, and keep their terms until expiry", () => {
  const { state, host } = table();
  const guest = game.join(state, "Guest");
  const rule = "luckySeven";
  const terms = { price: 750, rolls: 2, target: 12 };
  assert.throws(
    () => game.setHouseRuleOffer(state, guest.id, rule, terms),
    /table host/,
  );
  game.setHouseRule(state, host.id, rule, "purchase");
  game.setHouseRuleOffer(state, host.id, rule, terms);
  game.start(state, host.id);
  const offer = quote(state, rule);
  assert.throws(
    () => game.buyHouseRule(state, host.id, rule, { ...offer, price: 100 }),
    /offer changed/,
  );
  game.buyHouseRule(state, host.id, rule, offer);
  assert.equal(host.bank, 100000 - 750);
  assert.throws(
    () => game.buyHouseRule(state, host.id, rule, offer),
    /already have/,
  );
  assert.equal(host.bank, 100000 - 750);
  game.setHouseRuleOffer(state, host.id, rule, {
    price: 1500,
    rolls: 7,
    target: 1,
  });
  game.setHouseRule(state, host.id, "luckySevenPayout", 350);
  game.setHouseRule(state, host.id, rule, false);
  let result;
  for (const id of [host.id, guest.id]) game.place(state, id, "pass", 500);
  result = roll(state, [3, 4]);
  assert.deepEqual(
    result.events.map(({ delta }) => delta),
    [1000, 500],
  );
  assert.equal(result.houseRuleAttempts[0].target, 12);
  assert.equal(result.houseRuleAttempts[0].playerId, host.id);

  const saved = captureRoomSave(state, new Map([["host", host.id]]), []);
  // A paid pass from a previous save keeps its expiry and boost.
  const legacyPass = saved.state.players[0].houseRulePasses[rule];
  delete legacyPass.target;
  legacyPass.chance = 100;
  const legacyOffer = saved.state.config.houseRules.offers[rule];
  delete legacyOffer.target;
  legacyOffer.chance = 0;
  const resumed = readRoomSave(JSON.stringify(saved)).state;
  assert.equal(resumed.players[0].houseRulePasses[rule].target, 12);
  assert.equal(resumed.config.houseRules.offers[rule].target, 1);
  assert.equal(resumed.players[0].houseRulePasses[rule].expiresAfterRoll, 2);
  assert.equal(resumed.players[0].houseRulePasses[rule].value, 200);
  assert.equal(resumed.config.houseRules[rule], false);
  assert.equal(resumed.config.houseRules.offers[rule].rolls, 7);
  delete resumed.pausedAt;
  for (const [next, expected] of [
    [2, 1000],
    [3, 500],
  ]) {
    game.place(resumed, host.id, "pass", 500);
    result = roll(resumed, [3, 4]);
    assert.equal(result.index, next);
    assert.equal(result.events[0].delta, expected);
  }
});

function manualRoom(t) {
  const pending = new Map();
  const hub = new RoomHub("TESTAB", {
    timers: {
      setTimeout(fn) {
        const id = Symbol();
        pending.set(id, fn);
        return id;
      },
      clearTimeout: (id) => pending.delete(id),
    },
  });
  t.after(() => hub.close());
  const tick = () => {
    const [id, fn] = pending.entries().next().value;
    pending.delete(id);
    fn();
  };
  const errors = [];
  const join = (name) => {
    hub.connect(name, (message) => {
      if (message.type === "error") errors.push(message.message);
    });
    hub.receive(name, { type: "join", name, code: "TESTAB" });
  };
  return { hub, tick, join, errors };
}

test("only the drawn player can suspend and fling both dice", (t) => {
  const { hub, join, tick, errors } = manualRoom(t);
  const watched = [];
  hub.connect("TV", (message) => watched.push(message));
  join("Host");
  join("Guest");
  const state = hub.state;
  const [host, guest] = state.players;
  hub.receive("Host", { type: "house-rule", rule: "luckySeven", value: true });
  hub.receive("Host", { type: "house-rule", rule: "announce", value: true });
  hub.receive("Host", { type: "start", config: { rollCooldownSeconds: 0 } });
  hub.receive("Host", { type: "bet", betId: "pass", amount: 500 });
  const values = [0, 0xffffffff, 0];
  const native = crypto.getRandomValues.bind(crypto);
  t.mock.method(crypto, "getRandomValues", (buffer) => {
    if (!(buffer instanceof Uint32Array) || buffer.length !== 1)
      return native(buffer);
    assert(values.length, "Unexpected redraw");
    buffer[0] = values.shift();
    return buffer;
  });
  hub.receive("Host", { type: "roll", gesture: { x: 0, power: 0.7 } });
  assert(state.rolling);
  tick();
  const prompt = state.houseRulePrompt;
  assert.equal(prompt.rollerId, guest.id);
  assert.equal(prompt.phase, "entering");
  assert.equal(prompt.dice, undefined);
  const poses = prompt.poses.map((pose, index) => [
    pose[0],
    1.05 + index * 0.2,
    ...pose.slice(2),
  ]);
  const touch = { type: "house-rule-motion", promptId: prompt.id, poses };
  const launch = {
    type: "roll-house-rule",
    promptId: prompt.id,
    poses,
    velocities: [
      [0, 0, 0, 0.5, 0, 0],
      [0, 0, 0, 0, 0, 0],
    ],
    flick: 0.8,
    dice: [6, 6],
  };
  hub.receive("Guest", launch);
  assert.equal(state.houseRulePrompt.phase, "entering");
  tick();
  assert.equal(state.houseRulePrompt.phase, "ready");
  assert.equal(state.houseRulePrompt.canFling, true);
  const observedBefore = watched.length;
  hub.receive("Host", touch);
  hub.receive("Guest", { ...touch, promptId: "stale" });
  assert.equal(watched.length, observedBefore);
  hub.receive("Guest", touch);
  assert.equal(watched.length, observedBefore + 1);
  assert.equal(watched.at(-1).type, "house-rule-motion");
  assert.deepEqual(watched.at(-1).poses, poses);
  assert.deepEqual(state.houseRulePrompt.poses, prompt.poses);
  hub.receive("Guest", touch);
  assert.equal(watched.length, observedBefore + 1);

  hub.receive("Host", launch);
  assert.match(errors.pop(), /selected player/);
  assert.equal(state.houseRulePrompt.phase, "ready");
  hub.receive("Guest", launch);
  assert.equal(state.houseRulePrompt.phase, "rolling");
  const { flight } = state.houseRulePrompt;
  assert.deepEqual(
    flight.hops.map(({ frames }) => frames[0]),
    poses,
  );
  assert.deepEqual(
    watched.findLast((m) => m.type === "house-rule-motion").poses,
    poses,
  );
  assert(
    flight.hops.some(({ contacts }) =>
      contacts.some(({ surface }) => surface === "glass"),
    ),
  );
  assert.equal(state.houseRulePrompt.dice, undefined);
  hub.receive("Guest", launch);
  assert.equal(state.houseRulePrompt.flight, flight);
  tick();
  assert.equal(state.houseRulePrompt.phase, "resolving");
  assert.equal(state.houseRulePrompt.roll, undefined);
  assert.equal(state.houseRulePrompt.hit, undefined);
  assert.equal(host.bank, 99500);
  assert.deepEqual(
    state.houseRulePrompt.poses,
    flight.hops.map(({ frames }) => frames.at(-1)),
  );
  const faces = state.houseRulePrompt.poses.map(
    (pose) => upperDieFace(pose.slice(3)).value,
  );
  assert.deepEqual(faces, [2, 1]);
  tick();
  assert.equal(state.houseRulePrompt.phase, "revealed");
  assert.deepEqual(state.houseRulePrompt.dice, faces);
  assert.equal(state.houseRulePrompt.roll, 3);
  assert.equal(state.houseRulePrompt.hit, true);
  assert.equal(host.bank, 99500);
  tick();
  assert.equal(state.houseRulePrompt, undefined);
  assert.equal(host.bank, 101000);
  assert.equal(state.lastRoll.houseRuleAttempts[0].roll, 3);
  assert.equal(state.rolling, false);
  assert.equal(values.length, 0);
});

for (const [launchSeed, chanceTotal, hit] of [
  [8, 11, false],
  [4, 4, true],
]) {
  test(`an unanswered Second Wind check reveals the ${hit ? "hit" : "miss"} before the main throw`, (t) => {
    const { hub, join, tick } = manualRoom(t);
    join("Host");
    hub.receive("Host", {
      type: "house-rule",
      rule: "secondWind",
      value: true,
    });
    hub.receive("Host", { type: "house-rule", rule: "announce", value: true });
    hub.receive("Host", { type: "start", config: { rollCooldownSeconds: 0 } });
    const draws = [0, 0, launchSeed, launchSeed, ...(hit ? [2] : [])];
    const native = crypto.getRandomValues.bind(crypto);
    t.mock.method(crypto, "getRandomValues", (buffer) => {
      if (!(buffer instanceof Uint32Array) || buffer.length !== 1)
        return native(buffer);
      assert(draws.length);
      buffer[0] = draws.shift();
      return buffer;
    });
    const { state } = hub;
    hub.receive("Host", { type: "roll", gesture: { x: 0, power: 0.7 } });
    assert.equal(state.houseRulePrompt.phase, "entering");
    assert.equal(state.throw, null);
    tick();
    assert.equal(state.houseRulePrompt.phase, "ready");
    assert.equal(state.throw, null);
    tick();
    assert.equal(state.houseRulePrompt.phase, "rolling");
    assert.equal(state.houseRulePrompt.flight.hops.length, 2);
    tick();
    assert.equal(state.houseRulePrompt.phase, "resolving");
    tick();
    assert.equal(state.houseRulePrompt.phase, "revealed");
    assert.equal(state.houseRulePrompt.hit, hit);
    assert.equal(state.houseRulePrompt.roll, chanceTotal);
    assert.equal(state.throw, null);
    tick();
    assert.equal(state.houseRulePrompt, undefined);
    assert.equal(state.throw.seed, hit ? 2 : 0);
    tick();
    assert.equal(state.lastRoll.total, hit ? 5 : 7);
    assert.deepEqual(
      state.lastRoll.houseRulesTriggered,
      hit ? ["secondWind"] : undefined,
    );
    assert.equal(draws.length, 0);
  });
}

test("physical chance hops roll out all 36 pairs at equal odds", () => {
  const counts = new Map();
  for (let orientation = 0; orientation < 24 ** 2; orientation++) {
    const hops = createChanceDiceHops(orientation * CHANCE_HOP_BUCKET + 1619);
    const pair = hops
      .map(({ frames, face }) => {
        assert(
          frames.some((pose) => pose[1] > 0.8),
          "Die must hop off the felt",
        );
        const final = upperDieFace(frames.at(-1).slice(3));
        assert(final.alignment > 0.995);
        assert.equal(final.value, face);
        return face;
      })
      .join(",");
    counts.set(pair, (counts.get(pair) ?? 0) + 1);
  }
  assert.equal(counts.size, 36);
  assert([...counts.values()].every((count) => count === 16));
});

test("suspended dice lift, collide and fall under gravity", () => {
  const start = [
    [-0.84, 0.5, 0.14, 0, 0, 0, 1],
    [0.84, 0.5, 0.14, 0, 0, 0, 1],
  ];
  const pair = createDiceSuspension(start);
  const leftAlone = createDiceSuspension([start[0]]);
  const rightAlone = createDiceSuspension([start[1]]);
  const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  const centered = createDiceSuspension(start);
  for (let frame = 0; frame < 120; frame++) {
    centered.pullToward(0, 0);
    centered.step(1 / 60);
  }
  assert(distance(...centered.sample()) > 1.4, "A steady hold leaves a gap");

  const heights = [];
  const separations = [];
  let collided = false;
  for (let frame = 0; frame < 100; frame++) {
    for (const physics of [pair, leftAlone, rightAlone]) {
      physics.pullToward(0.24, -0.1);
      physics.step(1 / 60);
    }
    const [left, right] = pair.sample();
    const together = distance(left, right);
    const apart = distance(leftAlone.sample()[0], rightAlone.sample()[0]);
    if (together > 0.95 && apart < 0.65) collided = true;
    heights.push(left[1], right[1]);
    separations.push(together);
    assert(suspensionPoses([left, right]));
  }
  assert(
    collided,
    "The dice repel through contact when pulled to the same point",
  );
  assert(Math.max(...heights) > 1.15);
  assert(Math.max(...separations) - Math.min(...separations) > 0.4);
  const released = pair.sample();
  const lifted = released.reduce((sum, pose) => sum + pose[1], 0);
  const velocities = pair.velocities();
  const { hops } = simulateChanceDrop(released, velocities);
  assert.deepEqual(
    hops.map(({ frames }) => frames[0]),
    released,
  );
  const continued = createDiceSuspension(released, velocities);
  for (let frame = 1; frame <= 12; frame++) {
    continued.step(1 / 60);
    assert.deepEqual(
      hops.map(({ frames }) => frames[frame]),
      continued.sample(),
    );
  }
  pair.letGo();
  for (let frame = 0; frame < 48; frame++) pair.step(1 / 60);
  const lowered = pair.sample().reduce((sum, pose) => sum + pose[1], 0);
  assert(lowered < lifted - 0.3);
  assert.equal(suspensionPoses([[0, 0, 0, 0, 0, 0, 0], start[1]]), null);
});
