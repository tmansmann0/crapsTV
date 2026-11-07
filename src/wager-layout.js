// Pure shared physical/presentation layout. No THREE, DOM, or canvas imports.
import { lineWagerX, betRoute, routeKey } from "./chip-flow.js";
import { chipStackForAmount } from "./chip-stack.js";

export function chipLocation(bet, mode) {
  const points =
    mode === "crapless"
      ? [2, 3, 4, 5, 6, 8, 9, 10, 11, 12]
      : [4, 5, 6, 8, 9, 10];
  const [kind, num] = bet.type.split("-");
  let x = 1024,
    y = 900;
  if (bet.type === "pass") y = 920;
  else if (bet.type === "odds" && bet.parentType === "pass") y = 1085;
  else if (kind === "place" || bet.point) {
    const n = bet.point || Number(num);
    x = 136 + ((points.indexOf(n) + 0.5) * 1776) / points.length;
    y = kind === "place" ? 290 : bet.type === "odds" ? 380 : 345;
  } else if (bet.type === "dont") y = 840;
  else if (bet.type === "come") y = 470;
  else if (bet.type === "dontcome") {
    x = 285;
    y = 465;
  } else if (bet.type === "field") y = 710;
  else if (kind === "hard") {
    const i = [4, 6, 8, 10].indexOf(Number(num));
    x = mode !== "crapless" ? (i % 2 ? 370 : 210) : 1671;
    y = mode !== "crapless" ? (i < 2 ? 640 : 735) : 520 + i * 67;
  } else if (kind === "prop" || bet.type === "craps") {
    const row =
      bet.type === "craps"
        ? 1
        : Number(num) === 7
          ? 0
          : [2, 12].includes(Number(num))
            ? 2
            : 3;
    x = mode !== "crapless" ? 1750 : 1837;
    y = 520 + row * 67;
  } else if (kind === "big") {
    x = Number(num) === 6 ? 720 : 1320;
    y = 785;
  }
  return [
    (x / 2048 - 0.5) * 10.84 * (1588 / 1776),
    ((y * 0.82) / 1024 - 0.5) * 5.4,
  ];
}

export function wagerPosition(route, state) {
  const [x, z] = chipLocation(route.bet, state.config.mode);
  const player = state.players.find((p) => p.id === route.playerId);
  const index = player?.seat ?? 0;
  if (isLineWager(route.bet)) return [lineWagerX(index), 0.014, z];
  if (route.bet.point || route.bet.type.startsWith("place-")) {
    const columns = state.config.mode === "crapless" ? 3 : 4;
    const rows = Math.ceil(12 / columns);
    return [
      x + ((index % columns) - (columns - 1) / 2) * 0.24,
      0.014,
      z + (Math.floor(index / columns) - (rows - 1) / 2) * 0.17,
    ];
  }
  if (["come", "field"].includes(route.bet.type)) {
    return [
      x + ((index % 4) - 1.5) * 0.63,
      0.014,
      z + (Math.floor(index / 4) - 1) * 0.23,
    ];
  }
  return [
    x + ((index % 3) - 1) * 0.28,
    0.014,
    z + (Math.floor(index / 3) - 1.5) * 0.24,
  ];
}
export function isLineWager(bet) {
  return (
    ["pass", "dont"].includes(bet.type) ||
    (bet.type === "odds" && bet.parentType === "pass")
  );
}

const hash = (value) =>
  [...value].reduce((n, c) => (n * 31 + c.charCodeAt(0)) >>> 0, 0);

export function chipPileSpecs(
  amount,
  { diameter = 0.33, max = 8, opacity = 1, seed = "pile" } = {},
) {
  const height = 0.13 * diameter * 1.3;
  return chipStackForAmount(amount, max).chips.map((denomination, n) => ({
    denomination,
    wear: (hash(seed) + n) % 3,
    diameter,
    thicknessScale: 1.3,
    opacity,
    position: [
      Math.sin(n * 2.1) * 0.006,
      height / 2 + n * (height + 0.002),
      Math.cos(n * 1.7) * 0.006,
    ],
    rotation: [0, (hash(seed + n) % 628) / 100, 0],
  }));
}

export function wagerPileLayout(route, state, amount = route.bet.amount) {
  const compact =
    !isLineWager(route.bet) &&
    !!(route.bet.point || route.bet.type.startsWith("place-"));
  const diameter = compact ? 0.22 : 0.31;
  const chips = chipPileSpecs(amount, { diameter, seed: route.bet.id });
  const chipCount = chips.length;
  const chipHeight = 0.13 * diameter * 1.3;
  const height = chipHeight * chipCount + 0.002 * Math.max(0, chipCount - 1);
  const basePosition = wagerPosition(route, state);
  return {
    id: routeKey(route),
    playerId: route.playerId,
    betId: route.bet.id,
    basePosition,
    compact,
    diameter,
    chipCount,
    height,
    radius:
      diameter / 2 +
      Math.max(
        0,
        ...chips.map((chip) => Math.hypot(chip.position[0], chip.position[2])),
      ),
    position: [basePosition[0], basePosition[1] + height / 2, basePosition[2]],
  };
}

export const MAX_WAGER_STACKS = 1024;
export function wagerStackLayout(state) {
  const stacks = [];
  for (const player of state?.players || []) {
    if (player.left) continue;
    for (const bet of player.bets || []) {
      if (!(bet.amount > 0)) continue;
      if (stacks.length >= MAX_WAGER_STACKS)
        throw new RangeError("Too many physical wager stacks.");
      stacks.push(
        wagerPileLayout(betRoute(player.id, bet, player.bets), state),
      );
    }
  }
  return stacks;
}
