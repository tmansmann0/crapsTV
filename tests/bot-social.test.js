import assert from "node:assert/strict";
import test from "node:test";
import { pickDrinkRecipient } from "../src/bot-social.js";
import { planBotActions } from "../src/bot-strategies.js";
import * as game from "../src/game.js";

function table() {
  const state = game.createState("SOCIAL");
  const host = game.join(state, "Host");
  const guest = game.join(state, "Guest");
  const bot = game.addBot(state, host.id, {
    name: "Ruby",
    personality: "social",
    generosity: 100,
  });
  const rival = game.addBot(state, host.id, { name: "Vinny" });
  game.configure(state, host.id, { drinkingMode: true });
  game.start(state, host.id);
  for (const player of state.players)
    game.adjustBankroll(state, host.id, player.id, 10000);
  return { state, host, guest, bot, rival };
}

function roll(state, dice) {
  state.rolling = true;
  game.finishRoll(state, dice);
}

function sendDrink(state, from, to) {
  game.requestDrink(state, from.id, {
    kind: "offer",
    unit: "sip",
    quantity: 1,
    to: to.id,
  });
  game.respondToDrink(state, to.id, state.drinkRequests.at(-1).id, "complete");
}

function targetCount(state, bot, player) {
  let count = 0;
  for (let i = 0; i < 240; i++)
    if (pickDrinkRecipient(state, bot, (i + 0.5) / 240)?.id === player.id)
      count++;
  return count;
}

test("early craps create a grudge, big wins earn goodwill, and both fade", () => {
  const { state, host, bot } = table();
  assert.equal(targetCount(state, bot, host), 80);
  roll(state, [1, 1]);
  assert(targetCount(state, bot, host) > 80);
  const early = bot.drinkReactions[host.id].score;

  game.place(state, bot.id, "field", 2500);
  roll(state, [6, 6]);
  assert(bot.drinkReactions[host.id].score < -early);
  assert(targetCount(state, bot, host) < 80);
  for (let i = 0; i < 35; i++) roll(state, [3, 4]);
  assert.equal(targetCount(state, bot, host), 80);
});

test("a costly seven-out is blamed on the shooter rather than the next player", () => {
  const { state, rival, bot } = table();
  state.shooterId = rival.id;
  roll(state, [3, 3]);
  for (let i = 0; i < 3; i++) roll(state, [2, 2]);
  game.place(state, bot.id, "place-8", 3000);
  roll(state, [3, 4]);
  assert.notEqual(state.shooterId, rival.id);
  assert.equal(state.lastRoll.shooterId, rival.id);
  assert(bot.drinkReactions[rival.id].score >= 2);
  assert(targetCount(state, bot, rival) > 130);
});

test("repeated drinks turn bots against human and bot senders", () => {
  const { state, host, bot, rival } = table();
  for (const sender of [host, rival]) {
    const before = targetCount(state, bot, sender);
    sendDrink(state, sender, bot);
    const one = targetCount(state, bot, sender);
    assert(one > before);
    sendDrink(state, sender, bot);
    sendDrink(state, sender, bot);
    assert(targetCount(state, bot, sender) > one);
  }
  for (let i = 0; i < 35; i++) roll(state, [3, 4]);
  assert.equal(targetCount(state, bot, rival), 80);
});

test("a dogpile needs different senders, can target another bot, and expires", () => {
  const { state, host, guest, bot, rival } = table();
  bot.id = "ruby-social-test";
  sendDrink(state, host, rival);
  sendDrink(state, host, rival);
  assert.equal(targetCount(state, bot, rival), 80);
  sendDrink(state, guest, rival);
  assert(targetCount(state, bot, rival) > 100);

  let sentToRival = false;
  for (let i = 0; i < 24; i++) {
    sentToRival ||= planBotActions(state, bot.id).some(
      (action) => action.type === "drink-offer" && action.to === rival.id,
    );
    roll(state, [3, 4]);
  }
  assert(sentToRival);
  assert.equal(targetCount(state, bot, rival), 80);
});
