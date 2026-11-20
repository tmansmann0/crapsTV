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

test("Drinking Mode starts humans at zero and only peer-verified drinks fund play", () => {
  const { state, host, guest } = table();
  assert.equal(host.bank, 0);
  assert.equal(game.join(state, "Late guest").bank, 0);
  const bot = game.addBot(state, host.id, { name: "Dealer bot" });
  assert.equal(bot.bank, state.config.startingBank);
  assert.throws(() => game.reup(state, host.id), /verified chips/);
  assert.throws(() => game.place(state, host.id, "pass", 500), /Not enough/);
  assert.throws(() => requestCredit(state, host, "finish", 1), /off/);
  assert.throws(() => requestCredit(state, host, "sip", 0.5), /whole number/);
  const id = requestCredit(state, host, "sip", 2);
  assert.equal(host.bank, 0);
  assert.throws(() => requestCredit(state, host, "sip", 1), /pending/);
  assert.throws(
    () => game.respondToDrink(state, host.id, id, "accept"),
    /another player/,
  );
  assert.throws(
    () => game.respondToDrink(state, bot.id, id, "accept"),
    /human/,
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
  assert.throws(() => offer("sip", 1), /winnings/);

  game.place(state, host.id, "field", 4000);
  state.rolling = true;
  game.finishRoll(state, [1, 1]); // Field 2 pays double.
  assert.equal(game.net(host), 8000);
  assert.throws(() => offer("finish", 3), /whole number/);
  assert.throws(() => offer("shot", 4), /winnings/);
  const declined = offer("sip", 1);
  assert.equal(state.drinkRequests[0].amount, 780);
  assert.throws(
    () => game.respondToDrink(state, observer.id, declined, "accept"),
    /another player/,
  );
  game.respondToDrink(state, guest.id, declined, "decline");
  assert.equal(game.net(host), 8000);

  const accepted = offer("finish", 1);
  assert.equal(state.drinkRequests[0].amount, 3600);
  game.respondToDrink(state, guest.id, accepted, "accept");
  assert.equal(game.net(host), 4400);
  assert.equal(host.bank, 9200);
  assert.equal(guest.bank, 0);
  assert.throws(() => offer("shot", 3), /winnings/);

  const stale = offer("shot", 2);
  game.place(state, host.id, "field", 7000);
  assert.throws(
    () => game.respondToDrink(state, guest.id, stale, "accept"),
    /no longer/,
  );
  assert.equal(host.bank, 2200);
  game.respondToDrink(state, host.id, stale, "cancel");
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
  hub.receive("host", {
    type: "drink-response",
    requestId: request.id,
    response: "accept",
    playerId: guest.id,
  });
  assert.match(inbox.host.at(-1).message, /another player/);
  assert.equal(host.bank, 0);
  hub.receive("guest", {
    type: "drink-response",
    requestId: request.id,
    response: "accept",
  });
  assert.equal(host.bank, 500);
  hub.close();
});
