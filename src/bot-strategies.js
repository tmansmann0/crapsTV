import { catalogue, minimumPlayableBet } from "./game.js";
import { validBetChoices } from "./bet-options.js";
import { normalizeBotOptions } from "./bot-options.js";
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
  const level = levels[options.difficulty];
  if (
    !virtual.bets.length &&
    virtual.bank < minimumPlayableBet(state, virtual)
  ) {
    actions.push({ type: "reup" });
    virtual.bank = state.config.startingBank;
  }
  const equity = virtual.bank + sumBets(virtual.bets);
  const budget = Math.max(
    state.config.minBet,
    Math.floor(equity * level.exposure),
  );
  const unit = Math.max(
    state.config.minBet,
    Math.floor((equity * level.unit) / 100) * 100,
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
    if (!row?.available) return;
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
          const fraction = options.difficulty === "casual" ? 1 : 0.5;
          const increase = Math.max(
            row.minimum,
            Math.floor((profit * fraction) / row.quantum) * row.quantum,
          );
          const cap = desired * (options.difficulty === "expert" ? 3 : 5);
          desired = Math.min(cap, won.amount + increase);
        }
      }
      target(betId, desired);
    }
  }

  switch (options.strategy) {
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
  // A rounded $6/$12 place minimum can exceed an otherwise usable tiny bank.
  // Fall back to one legal line stake rather than silently leaving a funded
  // bot out of every roll. Locked existing wagers are never taken down.
  if (!virtual.bets.length && virtual.bank > 0)
    target(state.point ? "come" : "pass", state.config.minBet);
  return actions;
}
