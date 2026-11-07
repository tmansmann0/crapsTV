// Presentation only: the room's ledger stays authoritative throughout a payout.
export const MOBILE_DICE_HOLD_MS = 500;
export const MOBILE_PAYOUT_HOLD_MS = 950;
export const MOBILE_PAYOUT_FLIGHT_MS = 850;
export const MOBILE_PAYOUT_STAGGER_MS = 170;

export function mobilePayouts(roll, beforeBets, playerId) {
  const outcomes =
    roll?.events?.find((event) => event.playerId === playerId)?.bets || [];
  return outcomes.flatMap((outcome) => {
    if (!["win", "push"].includes(outcome.result)) return [];
    const bet = beforeBets.find((candidate) => candidate.id === outcome.betId);
    if (!bet) return []; // Never invent a position or stake after a reconnect.
    const standing =
      outcome.result === "win" && /^(place|hard|big)-/.test(bet.type);
    const profit = outcome.result === "win" ? Math.max(0, outcome.delta) : 0;
    const returnedStake = standing ? 0 : outcome.amount;
    const parent = beforeBets.find((candidate) => candidate.id === bet.parent);
    const source = bet.type === "odds" ? parent : bet;
    let anchors = [bet.type];
    if (source && ["come", "dontcome"].includes(source.type) && source.point)
      anchors = [`place-${source.point}`];
    else if (bet.type === "odds")
      anchors = [
        `odds:${bet.parent}`,
        ...(source ? [`odds-cue:${source.type}`, source.type] : []),
      ];
    const total = profit + returnedStake;
    return total > 0
      ? [
          {
            id: `${roll.id}:${bet.id}`,
            betId: bet.id,
            label: outcome.label || bet.name || bet.type,
            profit,
            returnedStake,
            standing,
            total,
            anchors,
          },
        ]
      : [];
  });
}

export function freshMobileSettlement(
  previous,
  next,
  playerId,
  now = Date.now(),
) {
  if (
    !previous ||
    !next ||
    previous.code !== next.code ||
    previous.createdAt !== next.createdAt ||
    next.status !== "playing" ||
    next.rolling ||
    !next.lastRoll ||
    next.lastRoll.id === previous.lastRoll?.id
  )
    return null;
  const serverNow = Number.isFinite(next.snapshotAt)
    ? next.snapshotAt
    : now + (next.clockOffsetMs || 0);
  if (Math.abs(serverNow - next.lastRoll.at) > 5000) return null;
  const before = previous.players?.find((player) => player.id === playerId);
  if (!before || before.left) return null;
  return {
    id: next.lastRoll.id,
    entries: mobilePayouts(next.lastRoll, before.bets, playerId),
  };
}
