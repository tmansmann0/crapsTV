import test from "node:test";
import assert from "node:assert/strict";
import * as game from "../src/game.js";
import { DEFAULT_DRINKING_RULES } from "../src/drinking-mode.js";
import { RoomHub } from "../src/hub.js";

function table(rules = DEFAULT_DRINKING_RULES) {
  const state = game.createState("DRINKS");
  const host = game.join(state, "Alice");
  const guest = game.join(state, "Jordan");
  const observer = game.join(state, "Sam");
  game.configure(state, host.id, { drinkingMode: true, drinkingRules: rules });
  game.start(state, host.id);
  return { state, host, guest, observer };
}

function requestCredit(state, player, unit, quantity) {
  game.requestDrink(state, player.id, { kind: "credit", unit, quantity });
  return state.drinkRequests.at(-1).id;
}

test("Drinking Mode starts humans at zero and top-ups require peer verification", () => {
  const { state, host, guest } = table();
  assert.equal(host.bank, 0);
  assert.equal(game.join(state, "Late guest").bank, 0);
  assert.throws(() => game.reup(state, host.id), /verified chips/);
  assert.throws(() => game.place(state, host.id, "pass", 500), /Not enough/);
  assert.throws(() => requestCredit(state, host, "finish", 1), /off/);
  assert.throws(() => requestCredit(state, host, "sip", 0.5), /whole number/);
  const id = requestCredit(state, host, "sip", 2);
  assert.equal(host.bank, 0);
  assert.throws(() => requestCredit(state, host, "sip", 1), /pending/);
  assert.throws(
    () => game.respondToDrink(state, host.id, id, "accept"),
    /another player/i,
  );
  game.respondToDrink(state, guest.id, id, "accept");
  assert.deepEqual([host.bank, host.buyIn, game.net(host)], [1000, 1000, 0]);
  assert.throws(
    () => game.respondToDrink(state, guest.id, id, "accept"),
    /already/,
  );
  game.place(state, host.id, "pass", 500);
  state.rolling = true;
  game.finishRoll(state, [3, 4]);
  assert.equal(host.bank, 1500);
  game.place(state, host.id, "pass", 1500);
  assert.equal(host.bank, 0);
});

test("host pricing, finish option, and markups apply to the correct transactions", () => {
  const rules = {
    sipValue: 650,
    shotValue: 1800,
    finishValue: 3000,
    finishEnabled: true,
    offerMarkup: 20,
  };
  const { state, host, guest, observer } = table(rules);
  assert.throws(() => requestCredit(state, host, "finish", 2), /whole number/);
  const topUp = requestCredit(state, host, "finish", 1);
  game.respondToDrink(state, guest.id, topUp, "accept");
  const shot = requestCredit(state, host, "shot", 1);
  game.respondToDrink(state, guest.id, shot, "accept");
  assert.equal(host.bank, 4800);
  const offer = (unit, quantity) => {
    game.requestDrink(state, host.id, {
      kind: "offer",
      unit,
      quantity,
      to: guest.id,
    });
    return state.drinkRequests.at(-1).id;
  };
  assert.equal(game.net(host), 0);
  assert.throws(() => offer("finish", 3), /whole number/);
  assert.throws(() => offer("shot", 3), /available chips/);
  const assigned = offer("sip", 1);
  assert.equal(state.drinkRequests[0].amount, 780);
  assert.equal(host.bank, 4020);
  assert.throws(
    () => game.respondToDrink(state, observer.id, assigned, "complete"),
    /Only the assigned player/,
  );
  for (const response of ["accept", "decline", "cancel"]) {
    assert.throws(
      () => game.respondToDrink(state, guest.id, assigned, response),
      /must be completed/,
    );
  }
  assert.throws(
    () => game.respondToDrink(state, host.id, assigned, "cancel"),
    /Only the assigned player/,
  );
  assert.throws(() => offer("sip", 1), /still open/);
  game.respondToDrink(state, guest.id, assigned, "complete");
  assert.equal(host.bank, 4020);

  const finish = offer("finish", 1);
  assert.equal(state.drinkRequests[0].amount, 3600);
  assert.equal(host.bank, 420);
  game.setDrinkingRules(state, host.id, { ...rules, finishEnabled: false });
  assert.throws(() => requestCredit(state, guest, "finish", 1), /off/);
  game.changeConnection(state, host.id, false);
  game.respondToDrink(state, guest.id, finish, "complete");
  game.changeConnection(state, host.id, true);
  assert.equal(host.bank, 420);
  assert.equal(guest.bank, 0);
  assert.throws(() => offer("sip", 1), /available chips/);
  assert.equal(host.bank, 420);
  assert.equal(state.drinkRequests.length, 0);
});

test("switching a lobby to Drinking Mode keeps bot seats with zero starting chips", () => {
  const state = game.createState("DRINKS");
  const host = game.join(state, "Host");
  const bot = game.addBot(state, host.id, { name: "Dealer bot" });
  const guest = game.join(state, "Guest");
  assert.equal(bot.bank, state.config.startingBank);
  game.rotateShooter(state);
  assert.equal(state.shooterId, bot.id);

  game.configure(state, host.id, {
    drinkingMode: true,
    minBet: state.config.startingBank + 100,
  });
  assert.deepEqual(
    state.players.map(({ id }) => id),
    [host.id, bot.id, guest.id],
  );
  assert.equal(state.adminId, host.id);
  assert.equal(state.shooterId, bot.id);
  assert.equal(state.botRollAt, null);
  assert.equal(state.config.minBet, 100100);
  assert.equal(game.addBot(state, host.id, { name: "Second bot" }).bank, 0);
  game.start(state, host.id);
  assert(state.players.every((player) => player.bank === 0));
});

test("bots drink for chips, approve top-ups, and complete assignments immediately", () => {
  const { state, host, guest } = table();
  const bot = game.addBot(state, host.id, {
    name: "Ruby",
    personality: "social",
  });
  assert.throws(() => requestCredit(state, bot, "sip", 1), /simulated/);
  assert.throws(
    () => game.simulateBotDrink(state, host.id, "sip", 1),
    /Only bots/,
  );
  assert.throws(() => game.reup(state, bot.id), /verified chips/);
  game.simulateBotDrink(state, bot.id, "sip", 2);
  assert.deepEqual([bot.bank, bot.buyIn, bot.botDrinkLoad], [1000, 1000, 2]);
  const send = (player, to) => {
    game.requestDrink(state, player.id, {
      kind: "offer",
      unit: "sip",
      quantity: 1,
      to: to.id,
    });
  };
  send(bot, guest);
  const fromBot = state.drinkRequests.at(-1).id;
  assert.equal(bot.bank, 375);
  assert.equal(guest.bank, 0);
  game.respondToDrink(state, guest.id, fromBot, "complete");
  game.requestDrink(state, host.id, {
    kind: "credit",
    unit: "sip",
    quantity: 2,
  });
  assert.deepEqual([host.bank, host.buyIn, game.net(host)], [1000, 1000, 0]);
  assert.match(state.log[0].text, /Ruby automatically approved/);
  send(host, bot);
  assert.equal(host.bank, 375);
  assert.equal(bot.botDrinkLoad, 3);
  assert.equal(bot.buyIn, 1000);
  assert.equal(bot.bank, 375);
  assert.equal(state.drinkRequests.length, 0);
});

test("the shared room takes the requester and prices from authoritative state", () => {
  const hub = new RoomHub("DRINKS");
  const inbox = { host: [], guest: [] };
  for (const id of Object.keys(inbox)) {
    hub.connect(id, (message) => inbox[id].push(message));
    hub.receive(id, { type: "join", code: "DRINKS", name: id });
  }
  hub.receive("host", { type: "start", config: { drinkingMode: true } });
  const [host, guest] = hub.state.players;
  hub.receive("host", {
    type: "drink-request",
    kind: "credit",
    unit: "sip",
    quantity: 1,
    amount: 100000,
    from: guest.id,
  });
  const request = hub.state.drinkRequests[0];
  assert.equal(request.amount, 500);
  assert.equal(request.from, host.id);
  const nextRules = { ...DEFAULT_DRINKING_RULES, sipValue: 600 };
  hub.receive("guest", { type: "drinking-rules", rules: nextRules });
  assert.match(inbox.guest.at(-1).message, /table host/);
  assert.equal(hub.state.config.drinkingRules.sipValue, 500);
  hub.receive("host", {
    type: "drinking-rules",
    rules: { ...nextRules, shotValue: null },
  });
  assert.match(inbox.host.at(-1).message, /enter drink values/i);
  hub.state.rolling = true;
  hub.receive("host", { type: "drinking-rules", rules: nextRules });
  assert.match(inbox.host.at(-1).message, /dice to land/);
  assert.equal(hub.state.config.drinkingRules.sipValue, 500);
  hub.state.rolling = false;
  hub.receive("host", { type: "drinking-rules", rules: nextRules });
  assert.deepEqual(inbox.guest.at(-1).state.config.drinkingRules, nextRules);
  assert.equal(hub.state.drinkRequests[0].amount, 500);
  hub.receive("host", {
    type: "drink-response",
    requestId: request.id,
    response: "accept",
    playerId: guest.id,
  });
  assert.match(inbox.host.at(-1).message, /another player/i);
  assert.equal(host.bank, 0);
  hub.receive("guest", {
    type: "drink-response",
    requestId: request.id,
    response: "accept",
  });
  assert.equal(host.bank, 500);
  requestCredit(hub.state, host, "sip", 1);
  assert.equal(hub.state.drinkRequests[0].amount, 600);
  hub.receive("host", { type: "end" });
  hub.receive("host", {
    type: "drinking-rules",
    rules: DEFAULT_DRINKING_RULES,
  });
  assert.match(inbox.host.at(-1).message, /session has ended/);
  assert.deepEqual(hub.state.config.drinkingRules, nextRules);
  hub.close();
});

test("one human can log top-ups and send a drink without waiting for the bot's turn", (t) => {
  const hub = new RoomHub("BOTAUT");
  t.after(() => hub.close());
  const messages = [];
  hub.connect("host", (message) => messages.push(message));
  const send = (type, fields = {}) => hub.receive("host", { type, ...fields });
  send("join", { code: "BOTAUT", name: "Alice" });
  send("start", { config: { drinkingMode: true } });
  const [host] = hub.state.players;
  const topUp = { kind: "credit", unit: "sip", quantity: 2 };
  send("drink-request", topUp);
  assert.match(messages.at(-1).message, /Another connected player/);
  send("add-bot", { name: "Ruby" });
  const [, bot] = hub.state.players;

  send("drink-request", { ...topUp, amount: 100000, from: bot.id });
  assert.equal(host.bank, 1000);
  assert.equal(messages.at(-1).state.players[0].bank, 1000);
  assert.equal(hub.state.drinkRequests.length, 0);
  send("drink-request", {
    kind: "offer",
    unit: "sip",
    quantity: 1,
    to: bot.id,
  });
  assert.equal(bot.botDrinkLoad, 1);
  assert.equal(host.bank, 375);
  assert.equal(hub.state.drinkRequests.length, 0);
  send("remove-bot", { playerId: bot.id });
  send("drink-request", topUp);
  assert.match(messages.at(-1).message, /Another connected player/);
  assert.equal(host.bank, 375);
});

test("a pending top-up auto-approves once when a bot joins and the dice are down", (t) => {
  const hub = new RoomHub("BOTAUT");
  t.after(() => hub.close());
  for (const id of ["host", "guest"]) {
    hub.connect(id, () => {});
    hub.receive(id, { type: "join", code: "BOTAUT", name: id });
  }
  const send = (type, fields = {}) => hub.receive("host", { type, ...fields });
  send("start", { config: { drinkingMode: true } });
  send("drink-request", { kind: "credit", unit: "shot", quantity: 1 });
  assert.equal(hub.state.drinkRequests.length, 1);
  hub.state.rolling = true;
  send("add-bot", { name: "Ruby" });
  assert.equal(hub.state.drinkRequests.length, 1);
  assert.equal(hub.state.players[0].bank, 0);
  game.finishRoll(hub.state, [3, 3]);
  hub.broadcast();
  hub.broadcast();
  assert.equal(hub.state.drinkRequests.length, 0);
  assert.equal(hub.state.players[0].bank, DEFAULT_DRINKING_RULES.shotValue);
});
