import { CHIP_DENOMINATIONS } from "./chip-stack.js";
import { chipHash } from "./chip-character.js";

const denominations = new Set(CHIP_DENOMINATIONS.map((chip) => chip.value));
const copy = (chip) => ({
  ...chip,
  ...(chip.position ? { position: [...chip.position] } : {}),
  ...(chip.rotation ? { rotation: [...chip.rotation] } : {}),
});
const idSet = (items) =>
  new Set(
    Array.from(items || [], (item) =>
      typeof item === "object" ? item.id : item,
    ),
  );
function identity(chip) {
  if (
    !chip ||
    typeof chip.id !== "string" ||
    !chip.id.length ||
    !denominations.has(chip.denomination)
  )
    throw new TypeError("Wager chips require an ID and a real denomination");
  const wear = chip.wear ?? chipHash(chip.appearanceId ?? chip.id) % 3;
  if (!Number.isInteger(wear) || wear < 0 || wear > 2)
    throw new TypeError("Wager chip wear must be 0–2");
  return {
    id: chip.id,
    denomination: chip.denomination,
    wear,
    appearanceId: chip.appearanceId ?? chip.id,
  };
}
function worldChip(geometry, physical) {
  return { ...copy(geometry), ...identity(physical) };
}

/**
 * Render-only identities over the authority's unchanged canonical chip geometry.
 * A denomination exchange creates new objects; an existing physical chip never
 * changes colour or wear. No money, rules, positions or collider counts change.
 */
export function createWagerChipPresentation({
  namespace = "wager",
  maxRoutes = 1024,
} = {}) {
  if (!Number.isInteger(maxRoutes) || maxRoutes < 1 || maxRoutes > 1024)
    throw new RangeError("Wager presentation supports 1–1024 active routes");
  const routes = new Map();
  const members = new Map();
  let serial = 0;
  function save(key, chips) {
    for (const chip of routes.get(key) || []) {
      const count = members.get(chip.id) - 1;
      if (count) members.set(chip.id, count);
      else members.delete(chip.id);
    }
    if (chips === null) {
      routes.delete(key);
      return;
    }
    for (const chip of chips)
      members.set(chip.id, (members.get(chip.id) || 0) + 1);
    routes.set(key, chips);
  }
  function reconcile(
    key,
    canonicalSpecs,
    { incoming = [], outgoingIds = [], sourceExchangeRemoved = [] } = {},
  ) {
    if (
      typeof key !== "string" ||
      !key.length ||
      !Array.isArray(canonicalSpecs)
    )
      throw new TypeError(
        "Wager presentation needs a route key and canonical chips",
      );
    if (!routes.has(key) && routes.size >= maxRoutes)
      throw new RangeError(
        "Too many active wager presentation routes; prune completed routes",
      );
    const previous = routes.get(key) || [];
    const initial = !routes.has(key);
    const outgoing = idSet(outgoingIds),
      exchangedSource = idSet(sourceExchangeRemoved);
    const old = previous.filter(
      (chip) => !outgoing.has(chip.id) && !exchangedSource.has(chip.id),
    );
    const known = new Map(previous.map((chip) => [chip.id, identity(chip)]));
    const arrivals = [],
      seen = new Map();
    for (const chip of incoming) {
      const physical = identity(chip),
        before = seen.get(chip.id) || known.get(chip.id);
      if (
        before &&
        (before.denomination !== physical.denomination ||
          before.wear !== physical.wear ||
          (chip.appearanceId !== undefined &&
            before.appearanceId !== physical.appearanceId))
      )
        throw new Error(
          "A physical wager chip cannot change denomination, wear or appearance",
        );
      if (seen.has(chip.id) || old.some((existing) => existing.id === chip.id))
        continue;
      seen.set(chip.id, physical);
      arrivals.push({ ...copy(chip), ...physical });
    }
    for (const chip of canonicalSpecs) {
      identity(chip);
      if (
        !Array.isArray(chip.position) ||
        chip.position.length !== 3 ||
        !chip.position.every(Number.isFinite) ||
        !Array.isArray(chip.rotation) ||
        chip.rotation.length !== 3 ||
        !chip.rotation.every(Number.isFinite)
      )
        throw new TypeError(
          "Canonical wager chips require finite world positions and rotations",
        );
    }
    // A cold baseline is the already-authored pile, not a fabricated exchange.
    if (initial && !arrivals.length && !exchangedSource.size) {
      const chips = canonicalSpecs.map((chip) => worldChip(chip, chip));
      if (new Set(chips.map((chip) => chip.id)).size !== chips.length)
        throw new Error("Canonical wager IDs must be unique");
      save(key, chips);
      return {
        chips: chips.map(copy),
        removed: [],
        added: chips.map(copy),
        exchange: null,
      };
    }
    const taken = new Set(),
      minted = [],
      blocked = new Set();
    for (const chip of [...canonicalSpecs, ...arrivals]) blocked.add(chip.id);
    const chips = canonicalSpecs.map((geometry, index) => {
      let physical = old[index];
      if (
        !physical ||
        physical.denomination !== geometry.denomination ||
        taken.has(physical.id)
      )
        physical = old.find(
          (chip) =>
            chip.denomination === geometry.denomination && !taken.has(chip.id),
        );
      physical ||= arrivals.find(
        (chip) =>
          chip.denomination === geometry.denomination && !taken.has(chip.id),
      );
      if (!physical) {
        let id;
        do {
          id = `wager-present:${namespace}:${serial++}`;
        } while (blocked.has(id) || members.has(id));
        blocked.add(id);
        physical = {
          id,
          denomination: geometry.denomination,
          wear: geometry.wear ?? chipHash(id) % 3,
          appearanceId: id,
        };
        minted.push(id);
      }
      taken.add(physical.id);
      return worldChip(geometry, physical);
    });
    const current = new Set(chips.map((chip) => chip.id));
    const removed = previous.filter((chip) => !current.has(chip.id));
    const added = chips.filter((chip) => !known.has(chip.id));
    // Incoming descriptors normally have flight targets. If only identity data
    // was supplied, display unmatched arrivals above the prior pile for change.
    const anchor = previous.at(-1) || canonicalSpecs[0];
    const unused = [
      ...old.filter((chip) => !taken.has(chip.id)),
      ...arrivals
        .filter((chip) => !taken.has(chip.id))
        .map((chip, index) => {
          if (chip.position && chip.rotation) return copy(chip);
          const geometry = anchor || {
            position: [0, 0, 0],
            rotation: [0, 0, 0],
            diameter: 0.31,
            thicknessScale: 1.3,
          };
          const spec = worldChip(geometry, chip);
          spec.position[1] +=
            (index + (previous.length ? 1 : 0)) *
            0.13 *
            (geometry.diameter ?? 0.31) *
            (geometry.thicknessScale ?? 1.3);
          return spec;
        }),
    ];
    const replacements = chips.filter((chip) => minted.includes(chip.id));
    const exchange =
      unused.length || (exchangedSource.size && added.length)
        ? {
            removed: unused.map(copy),
            added: (replacements.length
              ? replacements
              : exchangedSource.size
                ? added
                : []
            ).map(copy),
          }
        : null;
    save(key, chips);
    return {
      chips: chips.map(copy),
      removed: removed.map(copy),
      added: added.map(copy),
      exchange,
    };
  }
  const snapshot = (key) => ({ chips: (routes.get(key) || []).map(copy) });
  return {
    reconcile,
    snapshot,
    get: snapshot,
    sources() {
      return new Map([...routes].map(([key, chips]) => [key, chips.map(copy)]));
    },
    prune(keys) {
      const keep = new Set(keys);
      for (const key of routes.keys()) if (!keep.has(key)) save(key, null);
    },
    clear() {
      routes.clear();
      members.clear();
    },
    get size() {
      return routes.size;
    },
  };
}
