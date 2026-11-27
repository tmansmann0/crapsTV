export const HOUSE_RULES = {
  secondWind: {
    label: "Second Wind",
    detail: "An initial 7 can be rerolled once.",
    clip: "house-second-wind",
    setting: "secondWindTarget",
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
  secondWindTarget: {
    label: "Second Wind trigger total",
    defaultValue: 5,
    min: 1,
    max: 12,
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

export const HOUSE_RULE_INTRO_MS = 850;
export const HOUSE_RULE_REVEAL_PAUSE_MS = 720;
export const HOUSE_RULE_REVEAL_MS = 2000;
export const HOUSE_RULE_OFFER_SETTINGS = {
  price: { label: "Price in chips ($)", min: 100, max: 100000000, scale: 100 },
  rolls: { label: "Duration (table rolls)", min: 1, max: 100, scale: 1 },
  target: { label: "Trigger total", min: 1, max: 12, scale: 1 },
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

// Convert old percent targets to the nearest cumulative two-dice odds.
const TWO_DICE_CUMULATIVE_WAYS = [0, 1, 3, 6, 10, 15, 21, 26, 30, 33, 35, 36];

function houseRuleTarget(target, legacyChance, fallback) {
  if (validHouseRuleValue(HOUSE_RULE_OFFER_SETTINGS.target, target))
    return target;
  if (!Number.isInteger(legacyChance) || legacyChance < 0 || legacyChance > 100)
    return fallback;
  const expectedWays = legacyChance * 36;
  let closest = 1;
  for (const [index, ways] of TWO_DICE_CUMULATIVE_WAYS.entries()) {
    if (
      Math.abs(ways * 100 - expectedWays) <
      Math.abs(TWO_DICE_CUMULATIVE_WAYS[closest - 1] * 100 - expectedWays)
    )
      closest = index + 1;
  }
  return closest;
}

export function describeHouseRuleTarget(target) {
  if (target === 1) return "Never triggers";
  if (target === 12) return "Any total";
  if (target === 2) return "Roll a total of 2";
  return `Roll a total of ${target} or lower`;
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
    secondWindTarget: houseRuleTarget(
      saved?.secondWindTarget,
      saved?.secondWindChance,
      DEFAULT_HOUSE_RULES.secondWindTarget,
    ),
  };
}

export function houseRuleOffer(rules, rule) {
  const offer = rules?.offers?.[rule];
  const target =
    rule === "secondWind"
      ? houseRuleTarget(
          rules?.secondWindTarget,
          rules?.secondWindChance,
          DEFAULT_HOUSE_RULES.secondWindTarget,
        )
      : houseRuleTarget(offer?.target, offer?.chance, 12);
  return {
    price: validHouseRuleValue(HOUSE_RULE_OFFER_SETTINGS.price, offer?.price)
      ? offer.price
      : 500,
    rolls: validHouseRuleValue(HOUSE_RULE_OFFER_SETTINGS.rolls, offer?.rolls)
      ? offer.rolls
      : 5,
    target,
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
        !validHouseRuleValue(HOUSE_RULE_OFFER_SETTINGS.price, pass.price) ||
        !validHouseRuleValue(HOUSE_RULE_OFFER_SETTINGS.rolls, pass.rolls) ||
        !Number.isSafeInteger(pass.expiresAfterRoll) ||
        pass.expiresAfterRoll > completedRolls + pass.rolls ||
        (setting &&
          rule !== "secondWind" &&
          !validHouseRuleValue(HOUSE_RULE_SETTINGS[setting], pass.value))
      )
        return [];
      const target = houseRuleTarget(pass.target, pass.chance, null);
      if (target === null) return [];
      const { price, rolls, expiresAfterRoll } = pass;
      const value = rule === "secondWind" ? target : pass.value;
      return [[rule, { price, rolls, target, expiresAfterRoll, value }]];
    }),
  );
}

export function houseRuleAccess(rules, rule, player, completedRolls) {
  const pass = activeHouseRulePass(player, rule, completedRolls);
  if (pass) return { target: pass.target, value: pass.value, personal: true };
  if (rules?.[rule] !== true) return null;
  const { setting } = HOUSE_RULES[rule];
  return {
    target: houseRuleOffer(rules, rule).target,
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
