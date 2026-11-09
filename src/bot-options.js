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
export const BOT_FAIR_PLAY_NOTE =
  "Difficulty changes betting decisions, never the dice or payouts.";

/** Strict room input validation, shared by the authority and admin controller. */
export function normalizeBotOptions(options = {}) {
  if (!options || typeof options !== "object" || Array.isArray(options))
    throw new Error("Choose a bot strategy and difficulty.");
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
