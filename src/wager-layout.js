// Pure shared physical/presentation layout. No THREE, DOM, or canvas imports.
import { lineWagerX, betRoute, routeKey } from "./chip-flow.js";
import { chipStackForAmount } from "./chip-stack.js";
import {
  chipHash,
  chipStackPose,
  chipStackBounds,
  chipPoseBounds,
} from "./chip-character.js";
import {
  legacyBoardToWorld,
  boardPixelToWorld,
  BOARD_BET_REGIONS,
  BOARD_SPECIAL_REGIONS,
} from "./board-layout.js";

export function chipLocation(bet, mode) {
  const points =
    mode === "crapless"
      ? [2, 3, 4, 5, 6, 8, 9, 10, 11, 12]
      : [4, 5, 6, 8, 9, 10];
  const [kind, num] = bet.type.split("-");
  let x = 1024,
    y = 900;
  if (bet.type === "pass") y = 920;
  else if (bet.type === "dont") y = 840;
  else if (bet.type === "odds" && bet.parentType === "pass") y = 1085;
  else if (["place", "buy", "lay"].includes(kind) || bet.point) {
    const n = bet.point || Number(num);
    x = 136 + ((points.indexOf(n) + 0.5) * 1776) / points.length;
    y = ["place", "buy", "lay"].includes(kind)
      ? 290
      : bet.type === "odds"
        ? 380
        : 345;
  } else if (bet.type === "come") y = 470;
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
  if (kind === "bonus" || kind === "hop") {
    const [left, top, width, depth] = wagerRegion(bet, mode).pixelRect;
    return boardPixelToWorld(left + width / 2, top + depth / 2);
  }
  return legacyBoardToWorld(x, y);
}

function preferredPosition(route, state) {
  const [x, z] = chipLocation(route.bet, state.config?.mode);
  const player = state.players.find((p) => p.id === route.playerId);
  const index = player?.seat ?? 0;
  if (isLineWager(route.bet)) return [lineWagerX(index), 0.014, z];
  const rect = wagerRegion(route.bet, state.config?.mode)?.pixelRect;
  const diameter = preferredDiameter(route, state);
  let columns = 3,
    rows = 4,
    stepX = 0.28,
    stepZ = 0.24;
  if (numberBox(route.bet)) {
    columns = state.config?.mode === "crapless" ? 3 : 4;
    rows = Math.ceil(12 / columns);
    stepX = 0.24;
    stepZ = 0.17;
  } else if (["come", "field"].includes(route.bet.type)) {
    columns = 4;
    rows = 3;
    stepX = 0.63;
    stepZ = 0.23;
  }
  let centerX = x,
    centerZ = z;
  if (rect) {
    const [left, top] = boardPixelToWorld(rect[0], rect[1]);
    const [right, bottom] = boardPixelToWorld(
      rect[0] + rect[2],
      rect[1] + rect[3],
    );
    const radius = diameter / 2 + CHIP_JITTER + REGION_MARGIN;
    const minX = left + radius,
      maxX = right - radius;
    const minZ = top + radius,
      maxZ = bottom - radius;
    stepX = Math.min(stepX, Math.max(0, maxX - minX) / (columns - 1));
    stepZ = Math.min(stepZ, Math.max(0, maxZ - minZ) / (rows - 1));
    const halfX = (stepX * (columns - 1)) / 2,
      halfZ = (stepZ * (rows - 1)) / 2;
    centerX = clamp(x, minX + halfX, maxX - halfX);
    centerZ = clamp(z, minZ + halfZ, maxZ - halfZ);
  }
  return [
    centerX + ((index % columns) - (columns - 1) / 2) * stepX,
    0.014,
    centerZ + (Math.floor(index / columns) - (rows - 1) / 2) * stepZ,
  ];
}
const CHIP_JITTER = 0.009,
  REGION_MARGIN = 0.008,
  STACK_GAP = 0.009;
const numberBox = (bet) =>
  !isLineWager(bet) && !!(bet.point || /^(place|buy|lay)-/.test(bet.type));
const fallbackRegion = { pixelRect: [68, 836, 1912, 188] };
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
export function wagerRegion(bet, mode) {
  let key = bet.type;
  if (/^(buy|lay)-/.test(key)) key = key.replace(/^(buy|lay)-/, "place-");
  else if (key.startsWith("hop-")) key = "hops";
  else if (key === "odds" && bet.parentType === "pass") key = "pass-odds";
  else if (bet.point && !["pass", "dont"].includes(key))
    key = `place-${bet.point}`;
  const printed =
    BOARD_BET_REGIONS[mode === "crapless" ? "crapless" : "classic"];
  return printed[key] || printed[bet.type] || BOARD_SPECIAL_REGIONS[key];
}
function preferredDiameter(route, state) {
  const compact = numberBox(route.bet);
  const normal = compact ? 0.22 : 0.31;
  const rect = packingRect(route.bet, state.config?.mode);
  if (!rect) return normal;
  const [left, top] = boardPixelToWorld(rect[0], rect[1]);
  const [right, bottom] = boardPixelToWorld(
    rect[0] + rect[2],
    rect[1] + rect[3],
  );
  return Math.min(
    normal,
    Math.min(right - left, bottom - top) - 2 * (CHIP_JITTER + REGION_MARGIN),
  );
}
export function isLineWager(bet) {
  return (
    ["pass", "dont"].includes(bet.type) ||
    (bet.type === "odds" && bet.parentType === "pass")
  );
}

function packingRect(bet, mode) {
  const region = wagerRegion(bet, mode) || fallbackRegion;
  return region.pixelRects?.at(-1) ?? region.pixelRect;
}

function packingEntries(state, extraRoutes) {
  const entries = new Map();
  const add = (route, seat) => {
    const key = routeKey(route);
    const rect = packingRect(route.bet, state.config?.mode);
    const [left, top] = boardPixelToWorld(rect[0], rect[1]);
    const [right, bottom] = boardPixelToWorld(
      rect[0] + rect[2],
      rect[1] + rect[3],
    );
    entries.set(key, {
      key,
      seat,
      rectKey: rect.join(":"),
      diameter: preferredDiameter(route, state),
      bounds: [left, top, right, bottom],
      area: (right - left) * (bottom - top),
      preferred: preferredPosition(route, state),
    });
  };
  for (const player of state.players || []) {
    if (player.left) continue;
    for (const bet of player.bets || []) {
      if (!(bet.amount >= 100)) continue;
      if (entries.size >= MAX_WAGER_STACKS)
        throw new RangeError("Too many physical wager stacks.");
      add(betRoute(player.id, bet, player.bets), player.seat ?? 0);
    }
  }
  for (const route of extraRoutes)
    if (!entries.has(routeKey(route)))
      add(
        route,
        state.players?.find((p) => p.id === route.playerId)?.seat ?? 0,
      );
  return [...entries.values()];
}

function attemptPacking(entries, scale) {
  const placed = new Map(),
    cells = new Map();
  const cellSize = 0.35;
  const cellKey = (x, z) => x * 128 + z;
  function open(x, z, radius) {
    const gx = Math.floor(x / cellSize),
      gz = Math.floor(z / cellSize);
    for (let i = gx - 1; i <= gx + 1; i++)
      for (let j = gz - 1; j <= gz + 1; j++)
        for (const other of cells.get(cellKey(i, j)) || []) {
          const distance = radius + other.radius + STACK_GAP;
          if ((x - other.x) ** 2 + (z - other.z) ** 2 < distance ** 2)
            return false;
        }
    return true;
  }
  for (const entry of entries) {
    const diameter = entry.fixed?.diameter ?? entry.diameter * scale;
    const radius = diameter / 2 + CHIP_JITTER;
    const margin = radius + REGION_MARGIN;
    const [left, top, right, bottom] = entry.bounds;
    const minX = left + margin,
      maxX = right - margin;
    const minZ = top + margin,
      maxZ = bottom - margin;
    const preferredX =
      entry.fixed?.basePosition[0] ?? clamp(entry.preferred[0], minX, maxX);
    const preferredZ =
      entry.fixed?.basePosition[2] ?? clamp(entry.preferred[2], minZ, maxZ);
    let x = preferredX,
      z = preferredZ;
    if (!entry.fixed && !open(x, z, radius)) {
      const stride = Math.max(0.012, diameter * 0.39);
      const cols = Math.ceil((maxX - minX) / stride);
      const rows = Math.ceil((maxZ - minZ) / stride);
      let best = Infinity;
      for (let r = 0; r <= rows; r++) {
        const cz = minZ + (maxZ - minZ) * (r / Math.max(1, rows));
        const dz = (cz - preferredZ) ** 2;
        if (dz >= best) continue;
        for (let c = 0; c <= cols; c++) {
          const cx = minX + (maxX - minX) * (c / Math.max(1, cols));
          const distance = (cx - preferredX) ** 2 + dz;
          if (distance >= best || !open(cx, cz, radius)) continue;
          best = distance;
          x = cx;
          z = cz;
        }
      }
      if (best === Infinity) return null;
    }
    const key = cellKey(Math.floor(x / cellSize), Math.floor(z / cellSize));
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key).push({ x, z, radius });
    placed.set(entry.key, { basePosition: [x, 0.014, z], diameter });
  }
  return placed;
}

/** Lay out actual occupied positions, using the same coordinates on both peers. */
export function wagerPlacementMap(state, extraRoutes = []) {
  const entries = packingEntries(state, extraRoutes);
  const groupCounts = new Map();
  for (const { rectKey } of entries)
    groupCounts.set(rectKey, (groupCounts.get(rectKey) || 0) + 1);
  entries.sort(
    (a, b) =>
      a.area / groupCounts.get(a.rectKey) -
        b.area / groupCounts.get(b.rectKey) ||
      a.seat - b.seat ||
      (a.key < b.key ? -1 : a.key > b.key ? 1 : 0),
  );
  const packed = new Map();
  // Only a congested box and its neighbors need to give up diameter. Smaller
  // boxes are resolved first so a broad region cannot occupy a narrow lane.
  const groups = new Map();
  for (const entry of entries) {
    if (!groups.has(entry.rectKey)) groups.set(entry.rectKey, []);
    groups.get(entry.rectKey).push(entry);
  }
  for (const group of groups.values()) {
    let result;
    for (let scale = 1; scale > 0.045; scale *= 0.84) {
      result = attemptPacking([...packed.values(), ...group], scale);
      if (result) break;
    }
    if (!result) throw new RangeError("Wagers do not fit on the felt.");
    for (const entry of group) {
      const placement = result.get(entry.key);
      packed.set(entry.key, {
        ...entry,
        bounds: [
          placement.basePosition[0],
          placement.basePosition[2],
          placement.basePosition[0],
          placement.basePosition[2],
        ],
        fixed: placement,
      });
    }
  }
  return new Map([...packed].map(([key, entry]) => [key, entry.fixed]));
}

export function wagerPosition(route, state) {
  return wagerPlacementMap(state, [route]).get(routeKey(route)).basePosition;
}

export function wagerChipDiameter(route, state) {
  return wagerPlacementMap(state, [route]).get(routeKey(route)).diameter;
}

export function chipPileSpecs(
  amount,
  { diameter = 0.33, max = 8, opacity = 1, seed = "pile" } = {},
) {
  if (amount < 100) return [];
  return chipStackForAmount(amount, max).chips.map((denomination, n) => ({
    id: `${seed}:${n}`,
    denomination,
    wear: (chipHash(seed) + n) % 3,
    diameter,
    thicknessScale: 1.3,
    opacity,
    ...chipStackPose(seed, n, { diameter, thicknessScale: 1.3 }),
  }));
}

export function wagerPileLayout(
  route,
  state,
  amount = route.bet.amount,
  placement,
) {
  const compact = numberBox(route.bet);
  const { basePosition, diameter } =
    placement ?? wagerPlacementMap(state, [route]).get(routeKey(route));
  const chips = chipPileSpecs(amount, { diameter, seed: route.bet.id });
  const chipCount = chips.length;
  const bounds = chipStackBounds(chips);
  const height = bounds.height;
  return {
    id: routeKey(route),
    playerId: route.playerId,
    betId: route.bet.id,
    basePosition,
    compact,
    diameter,
    chipCount,
    height,
    radius: bounds.radius,
    impactChips: chips.slice(-3).map((chip, index, top) => {
      const chipBounds = chipPoseBounds(chip);
      return {
        layer: chips.length - top.length + index,
        position: chip.position.map(
          (value, axis) => value + basePosition[axis],
        ),
        rotation: chip.rotation,
        bottom: chipBounds.min[1] + basePosition[1],
        radius: chip.diameter / 2,
        height: chip.diameter * chip.thicknessScale * 0.13,
      };
    }),
    bounds: {
      min: bounds.min.map((v, i) => v + basePosition[i]),
      max: bounds.max.map((v, i) => v + basePosition[i]),
    },
    position: [
      basePosition[0],
      basePosition[1] + bounds.center[1],
      basePosition[2],
    ],
  };
}

export const MAX_WAGER_STACKS = 1024;
export function wagerStackLayout(state) {
  const stacks = [];
  if (!state) return stacks;
  const placements = wagerPlacementMap(state);
  for (const player of state?.players || []) {
    if (player.left) continue;
    for (const bet of player.bets || []) {
      if (!(bet.amount >= 100)) continue;
      if (stacks.length >= MAX_WAGER_STACKS)
        throw new RangeError("Too many physical wager stacks.");
      const route = betRoute(player.id, bet, player.bets);
      stacks.push(
        wagerPileLayout(
          route,
          state,
          bet.amount,
          placements.get(routeKey(route)),
        ),
      );
    }
  }
  return stacks;
}
