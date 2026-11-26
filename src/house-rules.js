export const HOUSE_RULES = {
  secondWind: {
    label: "Second Wind",
    detail: "An initial 7 can be rerolled once.",
    clip: "house-second-wind",
    setting: "secondWindChance",
  },
  hardPoint: {
    label: "Hard Point",
    detail: "Making the point with doubles boosts the Pass Line payout.",
    clip: "house-hard-point",
    setting: "hardPointPayout",
  },
  hotHand: {
    label: "Hot Hand",
    detail:
      "On the shooter’s third made point, players ahead on that roll earn extra profit.",
    clip: "house-hot-hand",
    setting: "hotHandBonus",
  },
  crapsCashback: {
    label: "Craps Cashback",
    detail:
      "In Classic, the Pass Line gets a refund on a come-out 2, 3, or 12.",
    clip: "house-craps-cashback",
    setting: "crapsCashbackPercent",
  },
  luckySeven: {
    label: "Lucky Seven",
    detail: "A come-out 7 boosts the Pass Line payout.",
    clip: "house-lucky-seven",
    setting: "luckySevenPayout",
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
    setting: "jackpotBonus",
  },
};

export const HOUSE_RULE_SETTINGS = {
  secondWindChance: {
    label: "Reroll chance (%)",
    defaultValue: 25,
    min: 0,
    max: 100,
    scale: 1,
  },
  hardPointPayout: {
    label: "Hard Point payout (× stake)",
    defaultValue: 125,
    min: 100,
    max: 1000,
    scale: 100,
  },
  hotHandBonus: {
    label: "Extra profit (%)",
    defaultValue: 25,
    min: 1,
    max: 100,
    scale: 1,
  },
  crapsCashbackPercent: {
    label: "Stake refunded (%)",
    defaultValue: 50,
    min: 1,
    max: 100,
    scale: 1,
  },
  luckySevenPayout: {
    label: "Lucky Seven payout (× stake)",
    defaultValue: 200,
    min: 100,
    max: 1000,
    scale: 100,
  },
  jackpotBonus: {
    label: "Jackpot bonus ($)",
    defaultValue: 2500,
    min: 100,
    max: 100000000,
    scale: 100,
  },
};

export const HOUSE_RULE_CHANCE_MS = 2100;
export const HOUSE_RULE_REVEAL_MS = 1150;
export const HOUSE_RULE_OFFER_SETTINGS = {
  price: { label: "Price in chips ($)", min: 100, max: 100000000, scale: 100 },
  rolls: { label: "Duration (table rolls)", min: 1, max: 100, scale: 1 },
  chance: { label: "Trigger chance (%)", min: 0, max: 100, scale: 1 },
};

export const DEFAULT_HOUSE_RULES = Object.freeze({
  ...Object.fromEntries(Object.keys(HOUSE_RULES).map((rule) => [rule, false])),
  announce: false,
  ...Object.fromEntries(
    Object.entries(HOUSE_RULE_SETTINGS).map(([key, { defaultValue }]) => [
      key,
      defaultValue,
    ]),
  ),
});

export function validHouseRuleValue(setting, value) {
  return (
    Number.isSafeInteger(value) && value >= setting.min && value <= setting.max
  );
}

export function normalizeHouseRules(saved) {
  return {
    ...Object.fromEntries(
      Object.keys(HOUSE_RULES).map((rule) => [
        rule,
        saved?.[rule] === "purchase" ? "purchase" : saved?.[rule] === true,
      ]),
    ),
    announce: saved?.announce === true,
    ...(saved?.offers && {
      offers: Object.fromEntries(
        Object.keys(HOUSE_RULES)
          .filter((rule) => saved.offers[rule])
          .map((rule) => [rule, houseRuleOffer(saved, rule)]),
      ),
    }),
    ...Object.fromEntries(
      Object.entries(HOUSE_RULE_SETTINGS).map(([key, setting]) => [
        key,
        validHouseRuleValue(setting, saved?.[key])
          ? saved[key]
          : setting.defaultValue,
      ]),
    ),
  };
}

export function houseRuleOffer(rules, rule) {
  const offer = rules?.offers?.[rule];
  const chance =
    rule === "secondWind" ? rules?.secondWindChance : offer?.chance;
  return {
    price: validHouseRuleValue(HOUSE_RULE_OFFER_SETTINGS.price, offer?.price)
      ? offer.price
      : 500,
    rolls: validHouseRuleValue(HOUSE_RULE_OFFER_SETTINGS.rolls, offer?.rolls)
      ? offer.rolls
      : 5,
    chance: validHouseRuleValue(HOUSE_RULE_OFFER_SETTINGS.chance, chance)
      ? chance
      : rule === "secondWind"
        ? DEFAULT_HOUSE_RULES.secondWindChance
        : 100,
  };
}

export function isHouseRuleForSale(config, rule) {
  return (
    Object.hasOwn(HOUSE_RULES, rule) &&
    config.houseRules?.[rule] === "purchase" &&
    (rule !== "crapsCashback" || config.mode !== "crapless")
  );
}

export function activeHouseRulePass(player, rule, completedRolls) {
  const pass = player?.houseRulePasses?.[rule];
  return pass?.expiresAfterRoll > completedRolls ? pass : null;
}

export function normalizeHouseRulePasses(saved, completedRolls) {
  return Object.fromEntries(
    Object.entries(HOUSE_RULES).flatMap(([rule, { setting }]) => {
      const pass = activeHouseRulePass(
        { houseRulePasses: saved },
        rule,
        completedRolls,
      );
      if (
        !pass ||
        !Object.entries(HOUSE_RULE_OFFER_SETTINGS).every(([key, range]) =>
          validHouseRuleValue(range, pass[key]),
        ) ||
        !Number.isSafeInteger(pass.expiresAfterRoll) ||
        pass.expiresAfterRoll > completedRolls + pass.rolls ||
        (setting &&
          !validHouseRuleValue(HOUSE_RULE_SETTINGS[setting], pass.value))
      )
        return [];
      const { price, rolls, chance, expiresAfterRoll, value } = pass;
      return [[rule, { price, rolls, chance, expiresAfterRoll, value }]];
    }),
  );
}

export function houseRuleAccess(rules, rule, player, completedRolls) {
  const pass = activeHouseRulePass(player, rule, completedRolls);
  if (pass) return { chance: pass.chance, value: pass.value, personal: true };
  if (rules?.[rule] !== true) return null;
  const { setting } = HOUSE_RULES[rule];
  return {
    chance: houseRuleOffer(rules, rule).chance,
    value: setting
      ? (rules[setting] ?? DEFAULT_HOUSE_RULES[setting])
      : undefined,
    personal: false,
  };
}

export function formatHouseRulePayout(percent) {
  for (const denominator of [1, 2, 4, 5, 10]) {
    const numerator = (percent * denominator) / 100;
    if (Number.isInteger(numerator)) return `${numerator}:${denominator}`;
  }
  return `${percent / 100}:1`;
}

export function newHouseHand() {
  return { made: 0, points: [], jackpotPlayers: [] };
}

export function canHandOffDice(state, playerId) {
  return (
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

export function canPassDice(state, playerId) {
  return (
    (state.lastRoll?.housePassAvailable ??
      state.config.houseRules?.passTheDice === true) &&
    state.status === "playing" &&
    !state.pausedAt &&
    !state.rolling &&
    !state.point &&
    state.shooterId === playerId &&
    state.lastRoll?.kind === "point-hit" &&
    state.lastRoll.shooterId === playerId &&
    state.houseHand?.made > 0 &&
    canHandOffDice(state, playerId)
  );
}
