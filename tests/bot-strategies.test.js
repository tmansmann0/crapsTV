import test from "node:test";
import assert from "node:assert/strict";
import * as game from "../src/game.js";
import { validBetChoices } from "../src/bet-options.js";
import {
  BOT_STRATEGIES,
  BOT_DIFFICULTIES,
  DEFAULT_BOT_OPTIONS,
  BOT_FAIR_PLAY_NOTE,
  normalizeBotOptions,
  planBotActions,
  MAX_BOT_ACTIONS,
} from "../src/bot-strategies.js";

function table({
  strategy = "line",
  difficulty = "regular",
  mode = "craps",
  startingBank = 100000,
  minBet = 500,
} = {}) {
  const state = game.createState("BOTQA");
  const host = game.join(state, "Human host"),
    bot = game.join(state, "Bot");
  game.configure(state, host.id, {
    mode,
    startingBank,
    minBet,
    rollCooldownSeconds: 0,
  });
  bot.bot = normalizeBotOptions({ strategy, difficulty });
  game.start(state, host.id);
  return { state, bot, host };
}
function execute(state, bot, actions = planBotActions(state, bot.id)) {
  assert(actions.length <= MAX_BOT_ACTIONS);
  for (const action of actions) {
    if (action.type === "reup") game.reup(state, bot.id);
    else if (action.type === "remove") game.remove(state, bot.id, action.betId);
    else {
      assert.equal(action.type, "bet");
      const row = game
        .catalogue(state, bot)
        .find((row) => row.id === action.betId);
      assert(
        validBetChoices(row, action.amount, bot).valid,
        `Illegal ${action.betId}: ${action.amount}`,
      );
      game.place(state, bot.id, action.betId, action.amount);
    }
  }
  assert(Number.isSafeInteger(bot.bank) && bot.bank >= 0);
  return actions;
}
function settle(state, dice) {
  // Trusted rules-only fixture. The planner never chooses these dice and the
  // product still uses the unmodified authoritative physical throw path.
  state.rolling = true;
  state.throw = null;
  game.finishRoll(state, dice);
}
function freeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

test("bot options expose distinct named styles and validate room inputs strictly", () => {
  assert.equal(BOT_STRATEGIES.length, 5);
  assert.deepEqual(
    BOT_DIFFICULTIES.map((item) => item.id),
    ["casual", "regular", "expert"],
  );
  assert.deepEqual(normalizeBotOptions(), DEFAULT_BOT_OPTIONS);
  assert.match(BOT_FAIR_PLAY_NOTE, /never the dice/);
  assert(Object.isFrozen(BOT_STRATEGIES) && Object.isFrozen(BOT_STRATEGIES[0]));
  for (const strategy of BOT_STRATEGIES)
    for (const difficulty of BOT_DIFFICULTIES)
      assert.deepEqual(
        normalizeBotOptions({
          strategy: strategy.id,
          difficulty: difficulty.id,
        }),
        { strategy: strategy.id, difficulty: difficulty.id },
      );
  for (const options of [
    null,
    [],
    "line",
    { strategy: "martingale" },
    { difficulty: "cheat" },
    { strategy: 1 },
    { difficulty: false },
    { strategy: null },
    { difficulty: null },
  ])
    assert.throws(() => normalizeBotOptions(options));
});

test("plans are pure, deterministic, bounded and never inspect future throw data", () => {
  const { state, bot } = table({ strategy: "six-eight" });
  const before = structuredClone(state);
  const frozen = freeze(structuredClone(state));
  const first = planBotActions(frozen, bot.id, { roundKey: "a" });
  assert(first.length > 0 && first.length <= MAX_BOT_ACTIONS);
  assert.deepEqual(planBotActions(frozen, bot.id, { roundKey: "b" }), first);
  assert.deepEqual(state, before);
  Object.defineProperty(state, "throw", {
    get() {
      throw Error("Bots must never inspect a future throw");
    },
  });
  assert.deepEqual(planBotActions(state, bot.id), first);
  assert.deepEqual(planBotActions({ ...before, status: "lobby" }, bot.id), []);
  assert.deepEqual(planBotActions({ ...before, status: "ended" }, bot.id), []);
  assert.deepEqual(planBotActions({ ...before, rolling: true }, bot.id), []);
  assert.deepEqual(planBotActions(before, "missing"), []);
  assert.deepEqual(
    planBotActions(before, before.adminId),
    [],
    "Human host is never automated",
  );
});

test("difficulty changes bet sizing and decisions, never odds or rule configuration", () => {
  const sizes = [];
  for (const difficulty of BOT_DIFFICULTIES) {
    const { state, bot } = table({ difficulty: difficulty.id });
    const config = structuredClone(state.config);
    const first = execute(state, bot);
    sizes.push(first.find((a) => a.betId === "pass").amount);
    settle(state, [3, 3]);
    const second = execute(state, bot);
    const odds = second.filter((a) => a.betId?.startsWith("odds:"));
    assert.equal(odds.length, difficulty.id === "casual" ? 0 : 1);
    assert.deepEqual(state.config, config);
  }
  assert(sizes[0] > sizes[1] && sizes[1] > sizes[2]);
});

test("pass and don’t bots take legal odds for every supported point and adapt to crapless", () => {
  for (const mode of ["craps", "crapless"])
    for (const strategy of ["line", "dark-side"])
      for (const point of mode === "crapless" ? game.ALL_POINTS : game.POINTS) {
        const { state, bot } = table({ mode, strategy, difficulty: "expert" });
        execute(state, bot);
        const first = bot.bets[0];
        assert.equal(
          first.type,
          strategy === "dark-side" && mode === "craps" ? "dont" : "pass",
        );
        settle(state, [Math.max(1, point - 6), Math.min(6, point - 1)]);
        assert.equal(state.point, point);
        const actions = execute(state, bot);
        assert(actions.some((action) => action.betId?.startsWith("odds:")));
        const odds = bot.bets.find((bet) => bet.type === "odds");
        assert(odds.amount <= first.amount * 5);
        assert.deepEqual(
          planBotActions(state, bot.id),
          [],
          "Completed plan does not top up repeatedly",
        );
      }
});

test("a bot joining an established point uses come without placing a locked late pass bet", () => {
  const { state, bot } = table();
  settle(state, [2, 2]);
  assert.deepEqual(
    execute(state, bot).map((action) => action.betId),
    ["come"],
  );
  settle(state, [3, 3]);
  const actions = execute(state, bot);
  assert(actions.some((action) => action.betId?.startsWith("odds:")));
  assert(!actions.some((action) => action.betId === "pass"));
});

test("six/eight and iron-cross styles form their distinct legal boards", () => {
  const six = table({ strategy: "six-eight" });
  execute(six.state, six.bot);
  assert.deepEqual(six.bot.bets.map((b) => b.type).sort(), [
    "place-6",
    "place-8",
  ]);
  assert.deepEqual(planBotActions(six.state, six.bot.id), []);
  const iron = table({ strategy: "iron-cross" });
  execute(iron.state, iron.bot);
  settle(iron.state, [2, 2]);
  execute(iron.state, iron.bot);
  assert.deepEqual(iron.bot.bets.map((b) => b.type).sort(), [
    "field",
    "pass",
    "place-5",
    "place-6",
    "place-8",
  ]);
});

test("press/collect reacts only to a completed own win and remains idempotent", () => {
  const { state, bot } = table({ strategy: "press", difficulty: "expert" });
  execute(state, bot);
  settle(state, [2, 2]);
  const six = bot.bets.find((b) => b.type === "place-6"),
    old = six.amount;
  settle(state, [3, 3]);
  const win = state.lastRoll.events
    .find((event) => event.playerId === bot.id)
    .bets.find((b) => b.betId === six.id);
  assert.equal(win.result, "win");
  const plan = execute(state, bot);
  assert(plan.some((action) => action.betId === "place-6"));
  assert(six.amount > old && six.amount <= old + win.delta);
  assert.deepEqual(planBotActions(state, bot.id), []);
  const other = structuredClone(state);
  other.lastRoll.events.forEach((event) => (event.playerId = "another-player"));
  assert.deepEqual(planBotActions(other, bot.id), []);
});

test("bust re-ups and near-minimum bankrolls still produce only executable legal actions", () => {
  for (const strategy of BOT_STRATEGIES) {
    const { state, bot } = table({
      strategy: strategy.id,
      startingBank: 1000,
      minBet: 700,
    });
    execute(state, bot);
    assert(
      bot.bets.length > 0,
      "Tiny funded bank falls back to an affordable legal line",
    );
    const busted = table({ strategy: strategy.id });
    busted.bot.bank = 0;
    const actions = execute(busted.state, busted.bot);
    assert.equal(actions[0].type, "reup");
    assert(busted.bot.bets.length > 0);
    assert.equal(busted.bot.stats.reups, 1);
  }
  const { state, bot } = table();
  execute(state, bot);
  settle(state, [2, 2]);
  bot.bank = 0;
  assert.deepEqual(
    planBotActions(state, bot.id),
    [],
    "Locked stake is retained rather than re-upping illegally",
  );
  const fractional = table({ minBet: 125 });
  fractional.bot.bank = 150;
  const reup = execute(fractional.state, fractional.bot);
  assert.equal(
    reup[0].type,
    "reup",
    "$1.50 cannot fund any legal $2 wager at a $1.25 minimum",
  );
  assert(fractional.bot.bets.length > 0);
});

test("all styles stay legal and bounded through long real-rule runs across both modes and awkward minima", () => {
  const dice = [
    [2, 2],
    [3, 3],
    [4, 4],
    [2, 3],
    [4, 5],
    [3, 4],
    [1, 1],
    [1, 2],
    [5, 6],
    [6, 6],
  ];
  for (const mode of ["craps", "crapless"])
    for (const strategy of BOT_STRATEGIES)
      for (const difficulty of BOT_DIFFICULTIES)
        for (const minBet of [125, 500, 1100]) {
          const { state, bot } = table({
            mode,
            strategy: strategy.id,
            difficulty: difficulty.id,
            minBet,
            startingBank: 100050,
          });
          for (let round = 0; round < 60; round++) {
            execute(state, bot);
            assert(bot.bets.length <= 6);
            assert(game.equity(bot) >= 0);
            settle(state, dice[round % dice.length]);
          }
          assert.equal(bot.stats.rolls, 60);
        }
});
