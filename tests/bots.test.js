import test from "node:test";
import assert from "node:assert/strict";
import * as game from "../src/game.js";
import { RoomHub } from "../src/hub.js";

function clock(t) {
  let now = 100000,
    serial = 0;
  const jobs = new Map();
  t.mock.method(Date, "now", () => now);
  return {
    now: () => now,
    timers: {
      setTimeout(fn, delay) {
        const id = ++serial;
        jobs.set(id, { at: now + delay, fn });
        return id;
      },
      clearTimeout(id) {
        jobs.delete(id);
      },
    },
    advance(ms) {
      const end = now + ms;
      let iterations = 0;
      while (true) {
        const next = [...jobs]
          .filter(([, job]) => job.at <= end)
          .sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        assert(
          ++iterations < 1000,
          "Scheduling must stay bounded, without a busy loop",
        );
        now = next[1].at;
        jobs.delete(next[0]);
        next[1].fn();
      }
      now = end;
    },
    get pending() {
      return jobs.size;
    },
  };
}
function hubTable(t, { cooldown = 10, delay = 5, start = true } = {}) {
  const time = clock(t),
    hub = new RoomHub("BOTQA", { timers: time.timers });
  t.after(() => hub.close());
  const messages = [];
  hub.connect("host", (m) => messages.push(m));
  hub.receive("host", { type: "join", code: "BOTQA", name: "Human" });
  const welcome = messages.find((m) => m.type === "welcome");
  hub.receive("host", {
    type: "add-bot",
    name: "Ada",
    strategy: "line",
    difficulty: "regular",
  });
  const bot = hub.state.players.find((p) => p.bot);
  if (start)
    hub.receive("host", {
      type: "start",
      config: { rollCooldownSeconds: cooldown, botRollDelaySeconds: delay },
    });
  return { hub, time, messages, bot, welcome, human: hub.state.players[0] };
}
function giveBotDice(hub) {
  game.rotateShooter(hub.state);
  hub.broadcast();
}

test("only the human admin can add named valid bots, sharing the twelve-seat capacity", (t) => {
  const { hub, messages, human, bot } = hubTable(t, { start: false });
  assert.deepEqual(bot.bot, { strategy: "line", difficulty: "regular" });
  assert.equal(bot.name, "Ada");
  assert.equal(bot.connected, true);
  assert.equal(hub.state.adminId, human.id);
  assert.equal(hub.state.config.botRollDelaySeconds, 5);
  hub.connect("guest", () => {});
  hub.receive("guest", { type: "join", code: "BOTQA", name: "Guest" });
  const guest = hub.state.players.at(-1);
  const count = hub.state.players.length;
  hub.receive("guest", { type: "add-bot", name: "Forged", strategy: "press" });
  assert.equal(hub.state.players.length, count);
  hub.receive("host", {
    type: "add-bot",
    name: "Invalid",
    strategy: "clairvoyant",
  });
  assert.equal(hub.state.players.length, count);
  assert.match(messages.at(-1).message, /strategy/i);
  assert.throws(() => game.transfer(hub.state, human.id, bot.id), /human/);
  assert.throws(() => game.removeBot(hub.state, human.id, guest.id), /bot/);
  while (hub.state.players.filter((p) => !p.left).length < 12)
    game.addBot(hub.state, human.id, {
      name: "Seat",
      strategy: "six-eight",
      difficulty: "expert",
    });
  assert.throws(
    () => game.addBot(hub.state, human.id, { name: "Overflow" }),
    /full/,
  );
  assert.throws(
    () => game.addBot(game.createState(), null, { name: "No host" }),
    /Join/,
  );
});

test("bot rolls wait five extra seconds after cooldown, place ordinary bets and use the real physical timeline", (t) => {
  const { hub, time, human, bot } = hubTable(t);
  giveBotDice(hub);
  assert.equal(hub.state.botRollAt, time.now() + 15000);
  hub.receive("host", { type: "bet", betId: "field", amount: 500 });
  time.advance(14999);
  assert.equal(hub.state.rolling, false);
  assert(bot.bets.length > 0, "Bot uses the ordinary betting ledger");
  assert.equal(human.bets[0].type, "field");
  time.advance(1);
  assert.equal(hub.state.rolling, true);
  assert.equal(hub.state.botRollAt, null);
  const timeline = hub.state.throw;
  assert.equal(timeline.playerId, bot.id);
  assert(timeline.frames.length > 2);
  const landed = [...timeline.dice];
  time.advance(2500);
  assert.deepEqual(hub.state.lastRoll.dice, landed);
  assert.equal(hub.state.lastRoll.throwId, timeline.id);
  assert.equal(hub.state.rolling, false);
  assert.equal(hub.state.rolls.length, 1);
});

test("bot delay is admin-controlled, bounded, and independent of human throw timing", (t) => {
  const { hub, time, human, bot, messages } = hubTable(t);
  hub.connect("guest", () => {});
  hub.receive("guest", { type: "join", code: "BOTQA", name: "Guest" });
  const before = hub.state.config.botRollDelaySeconds;
  hub.receive("guest", { type: "bot-delay", seconds: 0 });
  assert.equal(hub.state.config.botRollDelaySeconds, before);
  for (const seconds of [-1, 61, 1.1, "5", null, NaN, Infinity])
    assert.throws(
      () => game.setBotRollDelay(hub.state, human.id, seconds),
      /whole number/,
    );
  giveBotDice(hub);
  time.advance(3000);
  hub.receive("host", { type: "bot-delay", seconds: 2 });
  assert.equal(hub.state.botRollAt, 112000);
  hub.receive("host", { type: "cooldown", seconds: 5 });
  assert.equal(hub.state.botRollAt, 107000);
  // A human host can still choose to throw after the normal betting window.
  time.advance(2000);
  hub.receive("host", { type: "roll", gesture: { x: 0, power: 0.5 } });
  assert.equal(hub.state.rolling, true);
  assert.equal(hub.state.throw.playerId, human.id);
  assert.equal(hub.state.throw.shooterId, bot.id);
  assert(!messages.some((m) => m.type === "error"));
});

test("zero-delay bots still get one bounded decision and never spam multiple rolls", (t) => {
  const { hub, time, bot } = hubTable(t, { cooldown: 0, delay: 0 });
  giveBotDice(hub);
  const due = hub.state.botRollAt;
  assert(due > time.now());
  time.advance(due - time.now() - 1);
  assert.equal(hub.state.rolling, false);
  time.advance(1);
  assert.equal(hub.state.rolling, true);
  const id = hub.state.throw.id,
    bank = bot.bank;
  for (let i = 0; i < 10; i++) hub.broadcast();
  time.advance(1000);
  assert.equal(hub.state.throw.id, id);
  assert.equal(bot.bank, bank);
  assert.equal(
    time.pending,
    1,
    "Only the existing physical-roll completion remains",
  );
});

test("bots pause without connected humans; a spectator cannot restart them, reconnect gets a fresh delay", (t) => {
  const { hub, time, welcome, bot } = hubTable(t, { cooldown: 0 });
  giveBotDice(hub);
  time.advance(1000);
  const bank = bot.bank,
    betIds = bot.bets.map((b) => b.id);
  hub.disconnect("host");
  assert.equal(hub.state.botRollAt, null);
  assert.equal(time.pending, 0);
  hub.connect("tv", () => {});
  hub.receive("tv", { type: "watch" });
  time.advance(60000);
  assert.equal(hub.state.rolling, false);
  assert.equal(bot.bank, bank);
  hub.connect("return", () => {});
  hub.receive("return", { type: "join", code: "BOTQA", token: welcome.token });
  assert.equal(hub.state.botRollAt, time.now() + 5000);
  assert.deepEqual(
    bot.bets.map((b) => b.id),
    betIds,
    "Reconnect does not place the same window's bets again",
  );
  time.advance(4999);
  assert.equal(hub.state.rolling, false);
  time.advance(1);
  assert.equal(hub.state.rolling, true);
});

test("a human host holding aim pauses bot autoplay and canceling aim starts a fresh bot delay", (t) => {
  const { hub, time, human } = hubTable(t, { cooldown: 0 });
  giveBotDice(hub);
  time.advance(1000);
  hub.receive("host", {
    type: "aim",
    aim: { active: true, x: -0.25, power: 0.6 },
  });
  assert.equal(hub.state.aim?.playerId, human.id);
  assert.equal(hub.state.botRollAt, null);
  assert.equal(time.pending, 0);
  time.advance(6000);
  assert.equal(
    hub.state.rolling,
    false,
    "A timer must not throw while a human is holding the dice",
  );
  assert.equal(hub.state.aim?.active, true);
  hub.receive("host", {
    type: "aim",
    aim: { active: false, x: -0.25, power: 0.6 },
  });
  assert.equal(hub.state.aim, null);
  assert.equal(hub.state.botRollAt, time.now() + 5000);
  time.advance(4999);
  assert.equal(hub.state.rolling, false);
  time.advance(1);
  assert.equal(hub.state.rolling, true);
});

test("leaving/transfer never grants host to a bot; removal and session close cancel automatic work", (t) => {
  const { hub, time, human, bot } = hubTable(t);
  giveBotDice(hub);
  hub.receive("host", { type: "remove-bot", playerId: bot.id });
  assert.equal(bot.left, true);
  assert.equal(hub.state.botRollAt, null);
  assert.equal(hub.state.shooterId, human.id);
  assert.equal(time.pending, 0);
  hub.receive("host", {
    type: "add-bot",
    name: "Replacement",
    strategy: "press",
    difficulty: "expert",
  });
  const replacement = hub.state.players.at(-1);
  hub.receive("host", { type: "leave" });
  assert.equal(hub.state.adminId, null);
  assert.equal(replacement.bot.strategy, "press");
  assert.equal(time.pending, 0);
  hub.connect("new", () => {});
  hub.receive("new", { type: "join", code: "BOTQA", name: "New human" });
  assert.equal(hub.state.adminId, hub.state.players.at(-1).id);
  hub.close();
  assert.equal(time.pending, 0);
  time.advance(120000);
  assert.equal(hub.state.rolling, false);
});

test("end/reset releases bot schedules and a new lobby keeps the five-second default", (t) => {
  const { hub, time, bot } = hubTable(t);
  giveBotDice(hub);
  hub.receive("host", { type: "end" });
  assert.equal(hub.state.status, "ended");
  assert.equal(hub.state.botRollAt, null);
  assert.equal(time.pending, 0);
  assert.equal(bot.bets.length, 0);
  hub.receive("host", { type: "reset" });
  assert.equal(hub.state.status, "lobby");
  assert.equal(hub.state.players.length, 0);
  assert.equal(hub.state.config.botRollDelaySeconds, 5);
  assert.equal(hub.botWindows.size, 0);
  assert.equal(time.pending, 0);
});

test("re-up uses the cheapest playable denomination rather than an unusable fractional table minimum", () => {
  const state = game.createState("CENTS"),
    human = game.join(state, "Human");
  game.configure(state, human.id, { minBet: 125 });
  const bot = game.addBot(state, human.id, { name: "Change" });
  game.start(state, human.id);
  assert.equal(game.minimumPlayableBet(state, bot), 200);
  bot.bank = 150;
  assert.throws(() => game.place(state, bot.id, "field", 150));
  game.reup(state, bot.id);
  assert.equal(bot.bank, state.config.startingBank);
  assert.equal(bot.stats.reups, 1);
  bot.bank = 200;
  assert.throws(() => game.reup(state, bot.id), /below/);
  game.place(state, bot.id, "field", 200);
});
