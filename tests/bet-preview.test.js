import { RoomHub } from "../src/hub.js";
import test from "node:test";
import assert from "node:assert/strict";
import * as game from "../src/game.js";
test("preparing a bet is visible without spending or creating wagers", () => {
  const s = game.createState(),
    p = game.join(s, "A");
  game.start(s, p.id);
  const bank = p.bank;
  assert.equal(game.previewBet(s, p.id, 1000, "place-6", 1000), true);
  assert.equal(p.betPreview.valid, false);
  assert.equal(p.bank, bank);
  assert.equal(p.bets.length, 0);
  assert.equal(game.previewBet(s, p.id, 600, "place-6", 1010), false);
  assert.equal(game.previewBet(s, p.id, 600, "place-6", 1100), true);
  assert.equal(p.betPreview.valid, true);
  game.place(s, p.id, "place-6", 600);
  assert.equal(p.betPreview, null);
});
test("previews validate amount/target and clear for rolls and disconnects", () => {
  const s = game.createState(),
    p = game.join(s, "A");
  game.start(s, p.id);
  assert.throws(() => game.previewBet(s, p.id, p.bank + 1, null));
  assert.throws(() => game.previewBet(s, p.id, 500, "invented"));
  assert.throws(() => game.previewBet(s, p.id, -1, null));
  game.previewBet(s, p.id, 500, null);
  game.changeConnection(s, p.id, false);
  assert.equal(p.betPreview, null);
  game.changeConnection(s, p.id, true);
  game.previewBet(s, p.id, 500, null);
  game.beginRoll(s, p.id);
  assert.equal(p.betPreview, null);
  assert.throws(() => game.previewBet(s, p.id, 500, null));
});

test("stale preview errors are silent and cannot reject a real wager", () => {
  const hub = new RoomHub("PREVIEW");
  const messages = [];
  hub.connect("a", (m) => messages.push(m));
  hub.receive("a", { type: "join", name: "A", code: "PREVIEW" });
  hub.receive("a", { type: "start" });
  const n = messages.length;
  hub.receive("a", { type: "bet-preview", amount: 99999999, betId: "pass" });
  assert.equal(messages.length, n);
  hub.receive("a", { type: "bet", betId: "pass", amount: 500 });
  assert.equal(hub.state.players[0].bets.length, 1);
  hub.close();
});
