import test from "node:test";
import assert from "node:assert/strict";
import * as game from "../src/game.js";
import { RoomHub } from "../src/hub.js";

test("only the host can move available chips without rewriting existing wagers or P/L", (t) => {
  const hub = new RoomHub("BANKQA");
  t.after(() => hub.close());
  const hostMessages = [],
    guestMessages = [];
  hub.connect("host", (event) => hostMessages.push(event));
  hub.connect("guest", (event) => guestMessages.push(event));
  hub.receive("host", { type: "join", code: "BANKQA", name: "Host" });
  hub.receive("guest", { type: "join", code: "BANKQA", name: "Guest" });
  hub.receive("host", { type: "start" });
  hub.receive("guest", { type: "bet", betId: "pass", amount: 500 });

  const [host, guest] = hub.state.players;
  const adjustment = {
    type: "adjust-bankroll",
    playerId: guest.id,
    amount: 725,
  };
  const before = game.snapshot(hub.state);
  hub.receive("guest", adjustment);
  assert.match(guestMessages.at(-1).message, /only the table host/i);
  for (const amount of [
    0,
    0.5,
    "725",
    game.MAX_BANKROLL_ADJUSTMENT + 1,
    -100000,
  ]) {
    hub.receive("host", { ...adjustment, amount });
    assert.equal(hostMessages.at(-1).type, "error");
    assert.deepEqual(hub.state, before);
  }
  hub.receive("host", { ...adjustment, playerId: "missing" });
  assert.equal(hostMessages.at(-1).type, "error");
  assert.deepEqual(hub.state, before);

  hub.receive("host", adjustment);
  hub.receive("host", { ...adjustment, amount: -250 });
  assert.equal(guest.bank, 99975);
  assert.equal(guest.buyIn, 100000);
  assert.equal(game.net(guest), 0);
  assert.deepEqual(guest.bankrollAdjustments, { added: 725, removed: 250 });
  assert.deepEqual(guest.bets, before.players[1].bets);
  assert.equal(guest.history.at(-2).adjustment, 725);
  assert.equal(guest.history.at(-1).adjustment, -250);
  assert.equal(guest.history.at(-1).adminId, host.id);
  assert.match(hub.state.log[0].text, /Host removed \$2\.50 from Guest/);
  assert.equal(guestMessages.at(-1).state.players[1].bank, 99975);

  hub.state.rolling = true;
  hub.receive("host", adjustment);
  assert.match(hostMessages.at(-1).message, /dice are out/i);
  assert.equal(guest.bank, 99975);
  hub.state.rolling = false;
  hub.receive("guest", { type: "leave" });
  hub.receive("host", adjustment);
  assert.match(hostMessages.at(-1).message, /choose a player/i);
  hub.receive("host", { type: "end" });
  hub.receive("host", { ...adjustment, playerId: host.id });
  assert.match(hostMessages.at(-1).message, /isn.t taking bets/i);
});

test("drink assignments can use host-added chips but cannot spend withdrawn or wagered chips", () => {
  const state = game.createState();
  const host = game.join(state, "Host"),
    guest = game.join(state, "Guest");
  game.configure(state, host.id, { drinkingMode: true });
  game.start(state, host.id);
  game.requestDrink(state, guest.id, {
    kind: "credit",
    unit: "sip",
    quantity: 2,
  });
  game.respondToDrink(state, host.id, state.drinkRequests[0].id, "accept");
  const verified = guest.buyIn;

  game.adjustBankroll(state, host.id, guest.id, 2000);
  game.place(state, guest.id, "pass", 2000);
  game.adjustBankroll(state, host.id, guest.id, -375);
  assert.equal(game.net(guest), 0);
  const send = (quantity) =>
    game.requestDrink(state, guest.id, {
      kind: "offer",
      unit: "sip",
      quantity,
      to: host.id,
    });
  assert.throws(() => send(2), /available chips/);
  send(1);
  assert.equal(guest.bank, 0);
  assert.equal(guest.bets[0].amount, 2000);
  assert.equal(guest.buyIn, verified);
  assert.equal(state.drinkRequests[0].amount, 625);
});
