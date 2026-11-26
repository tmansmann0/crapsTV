export const DEFAULT_DRINKING_RULES = Object.freeze({
  sipValue: 500,
  shotValue: 10000,
  finishValue: 7500,
  finishEnabled: false,
  offerMarkup: 25,
});

export const DRINK_UNITS = [
  { id: "sip", label: "Sip", plural: "sips", valueKey: "sipValue" },
  { id: "shot", label: "Shot", plural: "shots", valueKey: "shotValue" },
  { id: "finish", label: "Finish drink", valueKey: "finishValue" },
];

export function drinkVerificationBot(players) {
  return players.find(
    (player) => player.bot && player.connected && !player.left,
  );
}

export function drinkUnits(rules) {
  return rules.finishEnabled ? DRINK_UNITS : DRINK_UNITS.slice(0, 2);
}

export function drinkPrice(rules, unit, kind) {
  const option = drinkUnits(rules).find((entry) => entry.id === unit);
  if (!option) return null;
  const value = rules[option.valueKey];
  if (kind === "credit") return value;
  return Math.round((value * (100 + rules.offerMarkup)) / 100);
}

export function drinkDescription(unit, quantity) {
  const option = DRINK_UNITS.find((entry) => entry.id === unit);
  if (unit === "finish") return "finish the drink";
  return `${quantity} ${quantity === 1 ? option.label.toLowerCase() : option.plural}`;
}

export function botDrinkLoadAfter(load, unit, quantity) {
  const weight = { sip: 1, shot: 4, finish: 6 }[unit] ?? 0;
  return Math.min(60, (load ?? 0) + weight * quantity);
}

export function validDrinkingRules(rules) {
  return (
    rules !== null &&
    typeof rules === "object" &&
    DRINK_UNITS.every(
      ({ valueKey }) =>
        Number.isSafeInteger(rules[valueKey]) &&
        rules[valueKey] >= 100 &&
        rules[valueKey] <= 100000000,
    ) &&
    typeof rules.finishEnabled === "boolean" &&
    Number.isSafeInteger(rules.offerMarkup) &&
    rules.offerMarkup >= 0 &&
    rules.offerMarkup <= 1000
  );
}
