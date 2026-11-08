/** Legal additional wager sizes for this exact row and current bankroll. */
export function validBetChoices(row, requested, player) {
  const minimum = row?.minimum || 0,
    step = row?.quantum || 100;
  const bank = Math.max(0, player?.bank || 0);
  const existing = row?.parent
    ? (player?.bets || [])
        .filter((b) => b.parent === row.parent)
        .reduce((n, b) => n + b.amount, 0)
    : 0;
  const room = row?.parent ? Math.max(0, row.max - existing) : bank;
  const maximum = Math.floor(Math.min(bank, room) / step) * step;
  const available = !!row?.available && minimum > 0 && maximum >= minimum;
  const amount =
    Number.isSafeInteger(requested) && requested >= 0 ? requested : 0;
  const valid =
    available && amount >= minimum && amount <= maximum && amount % step === 0;
  const down = Math.min(maximum, Math.floor(amount / step) * step);
  const up = Math.max(minimum, Math.ceil(amount / step) * step);
  const lower = available && down >= minimum && down <= amount ? down : null;
  const upper = available && up <= maximum && up >= amount ? up : null;
  const quick = available
    ? [...new Set([minimum, minimum * 2, minimum * 5])].filter(
        (v) => v <= maximum,
      )
    : [];
  const reason = !row?.available
    ? "This bet is not available on this roll."
    : !available
      ? bank < minimum
        ? "Your bank is below this bet’s minimum."
        : "No room remains under this bet’s limit."
      : amount > maximum
        ? "The bundle exceeds your available bank or odds limit."
        : amount < minimum
          ? "The bundle is below the minimum."
          : !valid
            ? "This bet needs a different chip increment."
            : "";
  return {
    minimum,
    step,
    maximum,
    requested: amount,
    valid,
    lower,
    upper,
    quick,
    reason,
  };
}
