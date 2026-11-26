import { betConflict, catalogue, minimumPlayableBet } from "./game.js";
import { validBetChoices } from "./bet-options.js";
import { BOT_STRATEGIES, normalizeBotOptions } from "./bot-options.js";
import { pickDrinkRecipient } from "./bot-social.js";
import {
  DEFAULT_DRINKING_RULES,
  botDrinkLoadAfter,
  drinkPrice,
  drinkUnits,
} from "./drinking-mode.js";
export {
  BOT_STRATEGIES,
  BOT_DIFFICULTIES,
  DEFAULT_BOT_OPTIONS,
  BOT_FAIR_PLAY_NOTE,
  normalizeBotOptions,
} from "./bot-options.js";

export const MAX_BOT_ACTIONS = 8;
const levels = Object.freeze({
  casual: { unit: 0.025, exposure: 0.3, odds: 0 },
  regular: { unit: 0.01, exposure: 0.2, odds: 1 },
  expert: { unit: 0.005, exposure: 0.15, odds: 2 },
});
const sumBets = (bets) => bets.reduce((sum, bet) => sum + bet.amount, 0);
const hash = (text) =>
  [...String(text)].reduce(
    (value, c) => Math.imul(value ^ c.charCodeAt(0), 16777619) >>> 0,
    2166136261,
  );
const habits = {
  balanced: "line",
  steady: "six-eight",
  social: "iron-cross",
  wild: "press",
};

/**
 * One small, deterministic betting-window plan. It never mutates the authority,
 * rolls dice, reads a future throw/seed, starts a timer, or searches outcomes.
 * Its ordinary actions are executed and validated sequentially by the room hub.
 */
export function planBotActions(state, playerId) {
  if (state?.status !== "playing" || state.rolling) return [];
  const player = state.players?.find((p) => p.id === playerId && !p.left);
  if (!player?.bot) return [];
  let options;
  try {
    options = normalizeBotOptions(player.bot);
  } catch {
    return [];
  }
  const actions = [];
  const virtual = { ...player, bets: player.bets.map((bet) => ({ ...bet })) };
  let seed = hash(`${state.code}:${player.id}:${state.rolls.length}`);
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const min = minimumPlayableBet(state, virtual);
  const drinking = !!state.config.drinkingMode;
  const rules = state.config.drinkingRules ?? DEFAULT_DRINKING_RULES;
  const risk = (options.risk ?? 45) / 100;
  let load = drinking ? (player.botDrinkLoad ?? 0) : 0;
  let refilled = false;
  if (drinking) {
    if (virtual.bank < min * 2) {
      const need = Math.max(min * 4, rules.sipValue * 2) - virtual.bank;
      const unit =
        (need > rules.sipValue * 6 && rules.shotValue > rules.sipValue) ||
        random() < risk * 0.2
          ? "shot"
          : "sip";
      const price = drinkPrice(rules, unit, "credit");
      const quantity = Math.ceil(need / price);
      actions.push({ type: "bot-drink", unit, quantity });
      virtual.bank += price * quantity;
      load = botDrinkLoadAfter(load, unit, quantity);
      refilled = true;
    }
  } else if (!virtual.bets.length && virtual.bank < min) {
    actions.push({ type: "reup" });
    virtual.bank = state.config.startingBank;
  }
  const instability = 1 - Math.exp(-load / 12);
  const variety = (options.variety ?? 0) / 100;
  const mix = variety + (1 - variety) * instability;
  const difficulty = options.difficulty ?? "regular";
  const level = options.personality
    ? {
        unit: 0.005 + risk * 0.04,
        exposure: 0.12 + risk * 0.32,
        odds: risk >= 0.6 ? 2 : 1,
      }
    : levels[difficulty];
  const stakeVariation = mix
    ? 1 + (random() * 2 - 1) * (mix * 0.3 + instability * 0.5)
    : 1;
  const equity = virtual.bank + sumBets(virtual.bets);
  const budget = Math.max(
    state.config.minBet,
    Math.floor(equity * level.exposure),
  );
  const unit = Math.max(
    state.config.minBet,
    Math.floor((equity * level.unit * stakeVariation) / 100) * 100,
  );
  const rows = new Map(catalogue(state, virtual).map((row) => [row.id, row]));
  let exposure = sumBets(virtual.bets);

  function held(row) {
    return virtual.bets
      .filter((bet) =>
        row.parent
          ? bet.parent === row.parent
          : bet.type === row.id && !bet.point,
      )
      .reduce((sum, bet) => sum + bet.amount, 0);
  }
  function target(betId, total) {
    if (actions.length >= MAX_BOT_ACTIONS) return;
    const row = rows.get(betId);
    if (!row?.available || betConflict(virtual, betId)) return;
    const existing = held(row),
      legalTotal = Math.max(
        row.minimum,
        Math.floor(total / row.quantum) * row.quantum,
      ),
      desired = legalTotal - existing;
    if (!(desired > 0)) return;
    // A large table minimum can exceed a percentage budget. Permit one legal
    // opening stake, rather than making a funded bot sit out indefinitely.
    const room =
      exposure === 0 ? Math.max(budget, row.minimum) : budget - exposure;
    const maximum =
      Math.floor(Math.min(virtual.bank, room) / row.quantum) * row.quantum;
    const requested = Math.floor(desired / row.quantum) * row.quantum;
    const amount = Math.min(requested, maximum);
    if (!validBetChoices(row, amount, virtual).valid) return;
    actions.push({ type: "bet", betId, amount });
    virtual.bank -= amount;
    exposure += amount;
    const old = virtual.bets.find((bet) =>
      row.parent ? bet.parent === row.parent : bet.type === betId && !bet.point,
    );
    if (old) old.amount += amount;
    else
      virtual.bets.push({
        id: `bot-plan:${betId}`,
        type: row.parent ? "odds" : betId,
        amount,
        point: row.parent
          ? virtual.bets.find((bet) => bet.id === row.parent)?.point
          : null,
        parent: row.parent || null,
      });
  }

  function line(against = false) {
    const main = against ? "dont" : "pass",
      travelled = against ? "dontcome" : "come";
    const parents = virtual.bets.filter((bet) =>
      [main, travelled].includes(bet.type),
    );
    if (!state.point) target(main, unit);
    else if (!parents.length) target(travelled, unit);
    if (!level.odds) return;
    for (const parent of parents.slice(0, 2))
      if (parent.point) target(`odds:${parent.id}`, parent.amount * level.odds);
  }
  function numbers(press = false) {
    const order = hash(player.id) % 2 ? [6, 8] : [8, 6];
    const event = state.lastRoll?.events?.find(
      (item) => item.playerId === player.id,
    );
    for (const number of order) {
      const betId = `place-${number}`,
        row = rows.get(betId);
      let desired = Math.max(
        row.minimum,
        Math.floor(unit / row.quantum) * row.quantum,
      );
      const bet = virtual.bets.find((item) => item.type === betId);
      const won =
        press &&
        event?.bets?.find(
          (item) => item.betId === bet?.id && item.result === "win",
        );
      if (won) {
        const profit = Math.max(0, won.delta || 0);
        // The legal increment can exceed half a small win. Collect until the
        // win covers at least a full increment; never press using a loss chase.
        if (profit >= row.minimum) {
          const fraction = difficulty === "casual" ? 1 : 0.5;
          const increase = Math.max(
            row.minimum,
            Math.floor((profit * fraction) / row.quantum) * row.quantum,
          );
          const cap = desired * (difficulty === "expert" ? 3 : 5);
          desired = Math.min(cap, won.amount + increase);
        }
      }
      target(betId, desired);
    }
  }

  const strategy =
    mix && random() < mix
      ? BOT_STRATEGIES[Math.floor(random() * BOT_STRATEGIES.length)].id
      : (options.strategy ?? habits[options.personality]);
  switch (strategy) {
    case "line":
      line();
      break;
    case "dark-side":
      line(state.config.mode !== "crapless");
      break;
    case "six-eight":
      numbers();
      break;
    case "press":
      numbers(true);
      break;
    case "iron-cross":
      if (!state.point) line();
      else {
        // Keep the two lower-quantum place bets affordable before adding field
        // coverage. All four still use exact authoritative increments/minima.
        numbers();
        target("place-5", unit);
        target("field", unit);
      }
      break;
  }
  if (mix && random() < mix * (0.25 + risk * 0.5)) {
    const extras = [
      "field",
      "place-4",
      "buy-10",
      "place-9",
      "hard-8",
      "hop-3-3",
    ];
    const start = Math.floor(random() * extras.length);
    const before = actions.length;
    for (let i = 0; i < extras.length && actions.length === before; i++)
      target(extras[(start + i) % extras.length], unit);
  }
  // A rounded $6/$12 place minimum can exceed an otherwise usable tiny bank.
  // Fall back to one legal line stake rather than silently leaving a funded
  // bot out of every roll. Locked existing wagers are never taken down.
  if (!virtual.bets.length && virtual.bank > 0)
    target(state.point ? "come" : "pass", state.config.minBet);
  if (
    drinking &&
    !refilled &&
    actions.length < MAX_BOT_ACTIONS &&
    !state.drinkRequests?.some(
      (request) => request.kind === "offer" && request.from === player.id,
    ) &&
    random() < ((options.generosity ?? 30) / 100) * (0.25 + instability * 0.2)
  ) {
    const affordable = drinkUnits(rules).filter(
      ({ id }) => drinkPrice(rules, id, "offer") <= virtual.bank - min * 2,
    );
    const recipient = pickDrinkRecipient(state, player, random());
    if (recipient && affordable.length) {
      const unit = affordable[Math.floor(random() * affordable.length)].id;
      actions.push({
        type: "drink-offer",
        unit,
        quantity: 1,
        to: recipient.id,
      });
    }
  }
  return actions;
}
