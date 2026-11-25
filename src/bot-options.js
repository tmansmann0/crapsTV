const choices = (items) => Object.freeze(items.map(Object.freeze));

export const BOT_STRATEGIES = choices([
  {
    id: "line",
    name: "Pass & odds",
    description:
      "Follows the pass line, then backs an established point with odds.",
  },
  {
    id: "six-eight",
    name: "Six & eight",
    description:
      "Keeps place bets on 6 and 8, collecting wins while the stakes stay up.",
  },
  {
    id: "iron-cross",
    name: "Iron cross",
    description:
      "Combines 5, 6 and 8 with the field after a point is established.",
  },
  {
    id: "press",
    name: "Press & collect",
    description:
      "Builds winning 6 and 8 bets with legal presses, keeping a bankroll reserve.",
  },
  {
    id: "dark-side",
    name: "Don’t pass",
    description:
      "Plays don’t pass and lay odds. Uses pass and odds in crapless mode.",
  },
]);

export const BOT_DIFFICULTIES = choices([
  {
    id: "casual",
    name: "Casual",
    description: "Simple, larger flat bets with fewer decisions.",
  },
  {
    id: "regular",
    name: "Regular",
    description:
      "Adds odds and measured presses while keeping chips in reserve.",
  },
  {
    id: "expert",
    name: "Advanced",
    description:
      "Smaller units, tighter exposure limits and more selective presses.",
  },
]);

export const DEFAULT_BOT_OPTIONS = Object.freeze({
  strategy: "line",
  difficulty: "regular",
});
export const BOT_PERSONALITIES = choices([
  {
    id: "balanced",
    name: "Balanced",
    risk: 45,
    variety: 55,
    generosity: 30,
    description: "Mixes line bets, odds, and bets on numbers.",
  },
  {
    id: "steady",
    name: "Steady",
    risk: 20,
    variety: 25,
    generosity: 10,
    description: "Prefers smaller stakes and familiar bets.",
  },
  {
    id: "social",
    name: "Social",
    risk: 40,
    variety: 65,
    generosity: 75,
    description: "Tries different bets and sends more drinks in Drinking Mode.",
  },
  {
    id: "wild",
    name: "Wild",
    risk: 80,
    variety: 90,
    generosity: 50,
    description: "Switches bets often and plays larger stakes.",
  },
]);
export const BOT_SLIDERS = Object.freeze(["risk", "variety", "generosity"]);
export const BOT_FAIR_PLAY_NOTE =
  "Personality affects the bot’s choices. Dice and payouts use the table rules.";

export function botPersonalityOptions(options) {
  if (options.personality !== undefined) return normalizeBotOptions(options);
  const personality =
    {
      "six-eight": "steady",
      "iron-cross": "social",
      press: "wild",
    }[options.strategy] ?? "balanced";
  return normalizeBotOptions({ personality });
}

/** Strict room input validation, shared by the authority and admin controller. */
export function normalizeBotOptions(options = {}) {
  if (!options || typeof options !== "object" || Array.isArray(options))
    throw new Error("Choose a bot personality.");
  if (
    options.personality !== undefined ||
    BOT_SLIDERS.some((key) => options[key] !== undefined) ||
    (options.strategy === undefined && options.difficulty === undefined)
  ) {
    const personality =
      options.personality === undefined
        ? BOT_PERSONALITIES[0].id
        : options.personality;
    const preset = BOT_PERSONALITIES.find(({ id }) => id === personality);
    if (!preset) throw new Error("Choose a valid bot personality.");
    const result = { personality };
    for (const key of BOT_SLIDERS) {
      const value = options[key] === undefined ? preset[key] : options[key];
      if (!Number.isInteger(value) || value < 0 || value > 100)
        throw new Error("Bot sliders must be whole numbers from 0 to 100.");
      result[key] = value;
    }
    return result;
  }
  const strategy =
    options.strategy === undefined
      ? DEFAULT_BOT_OPTIONS.strategy
      : options.strategy;
  const difficulty =
    options.difficulty === undefined
      ? DEFAULT_BOT_OPTIONS.difficulty
      : options.difficulty;
  if (!BOT_STRATEGIES.some((item) => item.id === strategy))
    throw new Error("Choose a valid bot strategy.");
  if (!BOT_DIFFICULTIES.some((item) => item.id === difficulty))
    throw new Error("Choose a valid bot difficulty.");
  return { strategy, difficulty };
}
