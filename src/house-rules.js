export const HOUSE_RULES = {
  secondWind: {
    label: "Second Wind",
    detail: "An initial 7 has a 50% chance of being rerolled once.",
    clip: "house-second-wind",
  },
  hardPoint: {
    label: "Hard Point",
    detail: "Make the point with doubles and the Pass Line pays 5:4.",
    clip: "house-hard-point",
  },
  hotHand: {
    label: "Hot Hand",
    detail:
      "On the shooter’s third made point, players ahead on that roll earn 25% more profit.",
    clip: "house-hot-hand",
  },
  crapsCashback: {
    label: "Craps Cashback",
    detail:
      "In Classic, the Pass Line gets half its stake back on a come-out 2, 3, or 12.",
    clip: "house-craps-cashback",
  },
  luckySeven: {
    label: "Lucky Seven",
    detail: "A come-out 7 pays 2:1 on the Pass Line.",
    clip: "house-lucky-seven",
  },
  passTheDice: {
    label: "Pass the Dice",
    detail:
      "After making a point, the shooter can hand the dice to the next player.",
    clip: "house-pass-the-dice",
  },
  tableJackpot: {
    label: "Table Jackpot",
    detail:
      "Make three different points in one turn. Each player who won a Pass Line bet on those rolls gets the jackpot bonus.",
    clip: "house-table-jackpot",
  },
};

export const DEFAULT_JACKPOT_BONUS = 2500;
export const MAX_JACKPOT_BONUS = 100000000;
export const DEFAULT_HOUSE_RULES = Object.freeze({
  ...Object.fromEntries(Object.keys(HOUSE_RULES).map((rule) => [rule, false])),
  announce: false,
  jackpotBonus: DEFAULT_JACKPOT_BONUS,
});

export function validJackpotBonus(value) {
  return (
    Number.isSafeInteger(value) && value >= 100 && value <= MAX_JACKPOT_BONUS
  );
}

export function normalizeHouseRules(saved) {
  return {
    ...Object.fromEntries(
      Object.keys(HOUSE_RULES).map((rule) => [rule, saved?.[rule] === true]),
    ),
    announce: saved?.announce === true,
    jackpotBonus: validJackpotBonus(saved?.jackpotBonus)
      ? saved.jackpotBonus
      : DEFAULT_JACKPOT_BONUS,
  };
}

export function newHouseHand() {
  return { made: 0, points: [], jackpotPlayers: [] };
}

export function canPassDice(state, playerId) {
  return (
    state.config.houseRules?.passTheDice === true &&
    state.status === "playing" &&
    !state.pausedAt &&
    !state.rolling &&
    !state.point &&
    state.shooterId === playerId &&
    state.lastRoll?.kind === "point-hit" &&
    state.lastRoll.shooterId === playerId &&
    state.houseHand?.made > 0 &&
    state.players.some(
      (player) =>
        player.id === playerId &&
        !player.bot &&
        !player.left &&
        player.connected,
    ) &&
    state.players.some(
      (player) => player.id !== playerId && !player.left && player.connected,
    )
  );
}
