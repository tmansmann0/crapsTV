const MEMORY_DECAY = 0.8;
const MAX_REACTION = 8;
const PILE_ON_ROLLS = 6;
const MAX_RECENT_ASSIGNMENTS = 72;

function reactionAt(bot, playerId, roll) {
  const reaction = bot.drinkReactions?.[playerId];
  if (!reaction) return 0;
  return reaction.score * MEMORY_DECAY ** Math.max(0, roll - reaction.roll);
}

function react(bot, playerId, roll, change) {
  const score = reactionAt(bot, playerId, roll) + change;
  (bot.drinkReactions ??= {})[playerId] = {
    score: Math.max(-MAX_REACTION, Math.min(MAX_REACTION, score)),
    roll,
  };
}

export function rememberBotRoll(
  state,
  bot,
  shooterId,
  early,
  roughRoll,
  before,
  delta,
) {
  if (!shooterId || shooterId === bot.id) return;
  const significant = Math.max(state.config.minBet * 4, before * 0.2);
  const roll = state.rolls.length + 1;
  if (delta > 0) {
    react(
      bot,
      shooterId,
      roll,
      -Math.min(3, 0.3 + (1.75 * delta) / significant),
    );
  } else if (roughRoll) {
    const earlyGrudge = early ? 0.8 : 0;
    const costlyGrudge =
      -delta >= significant ? Math.min(4, 1 + -delta / significant) : 0;
    if (earlyGrudge || costlyGrudge)
      react(bot, shooterId, roll, earlyGrudge + costlyGrudge);
  }
}

export function rememberDrinkAssignment(state, sender, recipient, quantity) {
  const roll = state.rolls.length;
  const recent = (state.recentDrinkAssignments ?? []).filter(
    (entry) => roll - entry.roll < PILE_ON_ROLLS,
  );
  recent.push({ from: sender.id, to: recipient.id, roll });
  state.recentDrinkAssignments = recent.slice(-MAX_RECENT_ASSIGNMENTS);
  if (recipient.bot) {
    const change = 0.9 + Math.min(1.5, 0.4 * Math.log2(quantity));
    react(recipient, sender.id, roll, change);
  }
}

export function forgetDrinkPlayer(state, id) {
  for (const player of state.players)
    if (player.drinkReactions) delete player.drinkReactions[id];
  if (state.recentDrinkAssignments)
    state.recentDrinkAssignments = state.recentDrinkAssignments.filter(
      (entry) => entry.from !== id && entry.to !== id,
    );
}

export function pickDrinkRecipient(state, bot, draw) {
  const peers = state.players.filter(
    (player) => player.id !== bot.id && !player.left && player.connected,
  );
  const roll = state.rolls.length;
  const pressure = new Map();
  for (const { from, to, roll: sentAt } of state.recentDrinkAssignments ?? []) {
    const age = roll - sentAt;
    if (from === bot.id || age >= PILE_ON_ROLLS) continue;
    if (!pressure.has(to)) pressure.set(to, new Map());
    pressure.get(to).set(from, 1 - age / PILE_ON_ROLLS);
  }
  const weights = peers.map(({ id }) => {
    const senders = pressure.get(id);
    const recentAttention =
      senders?.size >= 2
        ? [...senders.values()].reduce((sum, weight) => sum + weight, 0)
        : 0;
    const pileOn = Math.min(1.5, Math.max(0, recentAttention - 1) * 0.65);
    const reaction = reactionAt(bot, id, roll);
    return Math.exp(reaction * 0.38 + pileOn);
  });
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  let remaining = total * draw;
  return (
    peers.find((_, index) => (remaining -= weights[index]) < 0) ?? peers.at(-1)
  );
}
