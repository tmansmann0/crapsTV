import test from "node:test";
import assert from "node:assert/strict";
import * as g from "../src/game.js";
import { RoomHub } from "../src/hub.js";

test("active come teach odds follow its own point, not the table point", () => {
  const [s, p] = table();
  roll(s, p, 2, 2);
  g.place(s, p.id, "come", 500);
  roll(s, p, 3, 3);
  const bet = p.bets[0];
  assert.equal(g.describeBet(s, p, bet).prob, 5 / 11);
  assert.equal(s.point, 4);
});
function table(mode = "craps") {
  const s = g.createState("ABCDEF");
  const p = g.join(s, "Alice");
  g.configure(s, p.id, { mode });
  g.start(s, p.id);
  return [s, p];
}
function roll(s, p, a, b) {
  g.beginRoll(s, p.id);
  return g.finishRoll(s, [a, b]);
}
test("first player is admin, spectator cannot start; configuration validates integer money", () => {
  const s = g.createState();
  const a = g.join(s, "A"),
    b = g.join(s, "B");
  assert.equal(s.adminId, a.id);
  assert.throws(() => g.start(s, b.id));
  assert.throws(() => g.configure(s, a.id, { startingBank: NaN }));
  assert.throws(() => g.configure(s, a.id, { minBet: 0 }));
});
test("classic naturals, craps and point resolution, locked pass line", () => {
  const [s, p] = table();
  g.place(s, p.id, "pass", 500);
  roll(s, p, 6, 5);
  assert.equal(p.bank, 100500);
  g.place(s, p.id, "pass", 500);
  roll(s, p, 1, 1);
  assert.equal(p.bank, 100000);
  g.place(s, p.id, "pass", 500);
  roll(s, p, 3, 3);
  assert.equal(s.point, 6);
  assert.throws(() => g.remove(s, p.id, p.bets[0].id));
  roll(s, p, 4, 2);
  assert.equal(p.bank, 100500);
  assert.equal(s.point, null);
});
test("crapless 2,3,11,12 establish points; no don’t bets", () => {
  for (const [a, b] of [
    [1, 1],
    [1, 2],
    [5, 6],
    [6, 6],
  ]) {
    const [s, p] = table("crapless");
    g.place(s, p.id, "pass", 500);
    roll(s, p, a, b);
    assert.equal(s.point, a + b);
    assert.equal(p.bets[0].point, a + b);
    assert.throws(() => g.place(s, p.id, "dont", 500));
    roll(s, p, 3, 4);
    assert.equal(p.bank, 99500);
  }
});
test("don’t pass bar 12 pushes, point seven wins", () => {
  const [s, p] = table();
  g.place(s, p.id, "dont", 500);
  roll(s, p, 6, 6);
  assert.equal(p.bank, 100000);
  g.place(s, p.id, "dont", 500);
  roll(s, p, 2, 2);
  roll(s, p, 3, 4);
  assert.equal(p.bank, 100500);
});
test("place 6 off on come-out then pays 7:6 and stays up", () => {
  const [s, p] = table();
  g.place(s, p.id, "place-6", 600);
  roll(s, p, 3, 3);
  assert.equal(p.bank, 99400);
  roll(s, p, 4, 2);
  assert.equal(p.bank, 100100);
  assert.equal(p.bets.length, 1);
  roll(s, p, 2, 3);
  roll(s, p, 3, 4);
  assert.equal(p.bets.length, 0);
  assert.equal(p.bank, 100100);
});
test("field 2 double, 12 triple, loses on 8", () => {
  const [s, p] = table();
  g.place(s, p.id, "field", 500);
  roll(s, p, 1, 1);
  assert.equal(p.bank, 101000);
  g.place(s, p.id, "field", 500);
  roll(s, p, 6, 6);
  assert.equal(p.bank, 102500);
  g.place(s, p.id, "field", 500);
  roll(s, p, 4, 4);
  assert.equal(p.bank, 102000);
});
test("hardways off come-out then double pays, easy loses", () => {
  const [s, p] = table();
  g.place(s, p.id, "hard-6", 500);
  roll(s, p, 3, 3);
  assert.equal(p.bank, 99500);
  roll(s, p, 3, 3);
  assert.equal(p.bank, 104000);
  roll(s, p, 2, 3);
  roll(s, p, 2, 4);
  assert.equal(p.bets.length, 0);
});
test("true odds at all points, 5x cap and proper denominations", () => {
  for (const n of g.ALL_POINTS) {
    const [s, p] = table("crapless");
    g.place(s, p.id, "pass", 500);
    const dice = n <= 7 ? [1, n - 1] : [6, n - 6];
    roll(s, p, ...dice);
    const base = p.bets[0];
    const option = g.catalogue(s, p).find((b) => b.parent === base.id);
    const amount = option.minimum;
    g.place(s, p.id, option.id, amount);
    assert.throws(() => g.place(s, p.id, option.id, 30000));
    roll(s, p, ...dice);
    assert.equal(p.bank, 100500 + (amount * 6) / g.WAYS[n]);
  }
});
test("come point is independent; come odds off on come-out and returned on seven", () => {
  const [s, p] = table();
  roll(s, p, 2, 2);
  g.place(s, p.id, "come", 500);
  roll(s, p, 3, 3);
  const b = p.bets[0];
  assert.equal(b.point, 6);
  g.place(s, p.id, `odds:${b.id}`, 500);
  roll(s, p, 2, 2);
  assert.equal(s.point, null);
  roll(s, p, 3, 4);
  assert.equal(p.bank, 99500);
  assert.equal(p.bets.length, 0);
});
test("come-out winning traveled come returns off odds without profit", () => {
  const [s, p] = table();
  roll(s, p, 2, 2);
  g.place(s, p.id, "come", 500);
  roll(s, p, 3, 3);
  const b = p.bets[0];
  g.place(s, p.id, `odds:${b.id}`, 500);
  roll(s, p, 2, 2);
  roll(s, p, 3, 3);
  assert.equal(p.bank, 100500);
});
test("re-up restores start but never counts added chips as profit", () => {
  const [s, p] = table();
  g.place(s, p.id, "prop-2", 100000);
  roll(s, p, 3, 4);
  assert.equal(p.bank, 0);
  g.reup(s, p.id);
  assert.equal(p.bank, 100000);
  assert.equal(p.buyIn, 200000);
  assert.equal(g.net(p), -100000);
  assert.throws(() => g.reup(s, p.id));
});
test("cash out returns stakes; host transfers; close returns all unresolved bets", () => {
  const [s, p] = table();
  const b = g.join(s, "Bob");
  g.place(s, p.id, "pass", 500);
  roll(s, p, 2, 2);
  g.leave(s, p.id);
  assert.equal(p.bank, 100000);
  assert.equal(s.adminId, b.id);
  g.place(s, b.id, "place-6", 600);
  g.end(s, b.id);
  assert.equal(b.bank, 100000);
  assert.equal(s.status, "ended");
  assert.throws(() => g.join(s, "C"));
});
test("validation rejects bogus bets, overdrafts, cheating rolls and money", () => {
  const [s, p] = table();
  for (const x of [NaN, Infinity, -100, 1.2, 0, 10000000])
    assert.throws(() => g.place(s, p.id, "pass", x));
  assert.throws(() => g.place(s, p.id, "hacked", 500));
  assert.throws(() => g.finishRoll(s, [6, 6]));
  g.beginRoll(s, p.id);
  assert.throws(() => g.place(s, p.id, "pass", 500));
  assert.throws(() => g.finishRoll(s, [7, 0]));
  g.finishRoll(s, [1, 1]);
});
test("hub private token resumes identity, rejects forged identity and duplicate joins", () => {
  const h = new RoomHub("ABCDEF");
  let messages = [];
  h.connect("x", (m) => messages.push(m));
  h.receive("x", { type: "join", name: "A", code: "WRONG" });
  assert.equal(h.state.players.length, 0);
  h.receive("x", { type: "join", name: "A", code: "ABCDEF" });
  const welcome = messages.find((m) => m.type === "welcome");
  h.receive("x", { type: "join", name: "A", code: "ABCDEF" });
  assert.equal(h.state.players.length, 1);
  h.disconnect("x");
  h.connect("y", (m) => messages.push(m));
  h.receive("y", {
    type: "join",
    name: "A",
    code: "ABCDEF",
    token: welcome.token,
  });
  assert.equal(h.state.players.length, 1);
  h.connect("z", (m) => messages.push(m));
  h.receive("z", { type: "start", playerId: welcome.playerId });
  assert.equal(h.state.status, "lobby");
  assert(!JSON.stringify(g.snapshot(h.state)).includes(welcome.token));
  h.close();
});
test("RNG yields legal values and exhaustive field math matches displayed edge", () => {
  for (let i = 0; i < 1000; i++) {
    const d = g.randomDie();
    assert(d >= 1 && d <= 6);
  }
  let profit = 0;
  for (let a = 1; a <= 6; a++)
    for (let b = 1; b <= 6; b++) {
      const [s, p] = table();
      g.place(s, p.id, "field", 1000);
      roll(s, p, a, b);
      profit += g.equity(p) - 100000;
    }
  assert.equal(profit, -1000);
});
