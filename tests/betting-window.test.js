import test from "node:test";
import assert from "node:assert/strict";
import * as game from "../src/game.js";
import { RoomHub } from "../src/hub.js";
import {
  bettingSecondsRemaining,
  botRollSecondsRemaining,
} from "../src/betting-window.js";

function table() {
  const s = game.createState("WINDOW");
  const a = game.join(s, "Alice"),
    b = game.join(s, "Bob");
  game.start(s, a.id);
  return { s, a, b };
}

test("bot countdown includes its extra delay without extending human throw eligibility", () => {
  const state = {
    status: "playing",
    rolling: false,
    shooterId: "bot",
    players: [{ id: "bot", bot: { strategy: "line" } }],
    nextRollAt: 21000,
    botRollAt: 26000,
    clockOffsetMs: 5000,
  };
  assert.equal(bettingSecondsRemaining(state, 16000), 0);
  assert.equal(botRollSecondsRemaining(state, 16000), 5);
  assert.equal(botRollSecondsRemaining(state, 21000), 0);
  for (const change of [
    { rolling: true },
    { botRollAt: null },
    { status: "ended" },
    { shooterId: "human" },
    { players: [{ id: "bot", left: true, bot: {} }] },
  ])
    assert.equal(botRollSecondsRemaining({ ...state, ...change }, 16000), 0);
});

test("default window starts at table open; betting stays open and both throw paths lock", (t) => {
  let now = 100000;
  t.mock.method(Date, "now", () => now);
  const { s, a } = table();
  assert.equal(s.config.rollCooldownSeconds, 10);
  assert.equal(s.bettingOpenedAt, now);
  assert.equal(s.nextRollAt, now + 10000);
  game.place(s, a.id, "field", 500);
  assert.equal(a.bets.length, 1);
  assert.throws(() => game.beginRoll(s, a.id), /Betting open/);
  assert.throws(() => game.setAim(s, a.id, { x: 0, power: 1 }), /Betting open/);
  now += 9999;
  assert.throws(() => game.beginRoll(s, a.id), /Wait 1 second/);
  now++;
  game.setAim(s, a.id, { x: 0, power: 0.5 });
  game.beginRoll(s, a.id);
  assert.equal(s.rolling, true);
  now += 2500;
  game.finishRoll(s, [3, 4]);
  assert.equal(s.bettingOpenedAt, now);
  assert.equal(s.nextRollAt, now + 10000);
  assert.throws(() => game.beginRoll(s, s.shooterId), /Betting open/);
});

test("admin changes use the existing window origin, including zero and next-roll updates", (t) => {
  let now = 200000;
  t.mock.method(Date, "now", () => now);
  const { s, a, b } = table();
  assert.throws(() => game.setRollCooldown(s, b.id, 0), /host/);
  for (const value of [-1, 61, 1.5, NaN, Infinity, "5", null, true])
    assert.throws(() => game.setRollCooldown(s, a.id, value), /whole number/);
  assert.equal(s.config.rollCooldownSeconds, 10);
  now += 7000;
  game.setRollCooldown(s, a.id, 5);
  assert.equal(s.nextRollAt, 205000); // does not start another five seconds
  game.setAim(s, a.id, { x: 0, power: 0.5 });
  game.setRollCooldown(s, a.id, 60);
  assert.equal(s.aim, null);
  assert.equal(s.nextRollAt, 260000);
  game.setRollCooldown(s, a.id, 0);
  game.beginRoll(s, a.id);
  game.setRollCooldown(s, a.id, 15); // applies when these dice settle
  now += 2500;
  game.finishRoll(s, [2, 2]);
  assert.equal(s.nextRollAt, now + 15000);
  game.end(s, a.id);
  assert.throws(() => game.setRollCooldown(s, a.id, 5), /ended/);
});

test("hub rejects repeated/forged throws and preserves cooldown through reconnect", (t) => {
  let now = 300000;
  t.mock.method(Date, "now", () => now);
  const hub = new RoomHub("WINDOW"),
    messages = [];
  t.after(() => hub.close());
  hub.connect("one", (message) => messages.push(message));
  hub.receive("one", { type: "join", code: "WINDOW", name: "Alice" });
  const { token } = messages.find((message) => message.type === "welcome");
  hub.receive("one", { type: "start" });
  const deadline = hub.state.nextRollAt;
  for (let i = 0; i < 3; i++)
    hub.receive("one", { type: "roll", nextRollAt: 0, now: now + 60000 });
  assert.equal(hub.state.rolling, false);
  assert.equal(
    messages.filter((message) => message.type === "error").length,
    3,
  );
  hub.disconnect("one");
  const reconnected = [];
  hub.connect("two", (message) => reconnected.push(message));
  hub.receive("two", { type: "join", code: "WINDOW", token });
  hub.receive("two", { type: "roll" });
  assert.match(reconnected.at(-1).message, /Betting open/);
  assert.equal(hub.state.nextRollAt, deadline);
  hub.receive("two", { type: "cooldown", seconds: 0 });
  assert.equal(hub.state.nextRollAt, hub.state.bettingOpenedAt);
  assert.equal(hub.state.config.rollCooldownSeconds, 0);
});

test("lobby configuration validates cooldown and shared countdown corrects device clocks", () => {
  const s = game.createState(),
    a = game.join(s, "Alice");
  assert.throws(() => game.configure(s, a.id, { rollCooldownSeconds: "10" }));
  game.configure(s, a.id, { rollCooldownSeconds: 0 });
  assert.equal(s.config.rollCooldownSeconds, 0);
  const state = {
    status: "playing",
    rolling: false,
    nextRollAt: 21000,
    clockOffsetMs: 5000,
  };
  assert.equal(bettingSecondsRemaining(state, 15000), 1);
  assert.equal(bettingSecondsRemaining(state, 16000), 0);
  assert.equal(
    bettingSecondsRemaining({ ...state, clockOffsetMs: -5000 }, 15000),
    11,
  );
  assert.equal(bettingSecondsRemaining({ ...state, rolling: true }, 0), 0);
  assert.equal(bettingSecondsRemaining({ ...state, nextRollAt: null }, 0), 0);
});
