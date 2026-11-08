import { CHIP_DENOMINATIONS } from "./chip-stack.js";
import { chipHash } from "./chip-character.js";

const DENOMS = CHIP_DENOMINATIONS.map(({ value }) => value);
const descending = [...DENOMS].reverse();
const cents = (value, name = "amount") => {
  if (!Number.isSafeInteger(value) || value < 0)
    throw Error(`${name} must be nonnegative safe integer cents`);
  return value;
};
const valueOf = (chips) =>
  chips.reduce((sum, chip) => sum + chip.denomination, 0);
const copyChip = (chip) => ({ ...chip });

/**
 * Persistent DISPLAY inventory. It never changes a game balance or rule. Every
 * visible chip is one real denomination; excess value is explicitly reserved,
 * never disguised by multiplying the value of a single rendered chip.
 */
export function createBankChipInventory({
  namespace = "room",
  slots = 10,
  perStack = 10,
} = {}) {
  if (
    !Number.isInteger(slots) ||
    slots < 1 ||
    slots > 10 ||
    !Number.isInteger(perStack) ||
    perStack < 5 ||
    perStack > 24
  )
    throw Error("Inventory supports1–10slots and5–24chips per stack");
  const routes = new Map(),
    identities = new Map(),
    serials = new Map();
  let roomKey = String(namespace);
  function fresh(routeId, options) {
    return {
      routeId,
      amount: 0,
      reserveCents: 0,
      serial: serials.get(routeId) ?? 0,
      revision: 0,
      chips: [],
      initialMode: options.initialMode === "wager" ? "wager" : "bank",
      startingBank: options.startingBank,
      minBet: options.minBet ?? 500,
    };
  }
  function clone(state) {
    return { ...state, chips: state.chips.map(copyChip) };
  }
  function issue(state, denomination) {
    let id;
    do {
      id = `${roomKey}/${encodeURIComponent(state.routeId)}/chip/${state.serial++}`;
    } while (identities.has(id) || state.chips.some((chip) => chip.id === id));
    return {
      id,
      denomination,
      wear: chipHash(id) % 3,
      slot: null,
      stackIndex: null,
      level: null,
    };
  }
  function stacks(state) {
    const result = [];
    for (let slot = 0; slot < slots; slot++) {
      const chips = state.chips
        .filter((chip) => chip.slot === slot)
        .sort((a, b) => a.level - b.level);
      if (chips.length)
        result.push({
          slot,
          denomination: chips[0].denomination,
          count: chips.length,
          visibleCount: chips.length,
          chips,
        });
    }
    return result;
  }
  function place(state, chip, preferred) {
    const groups = stacks(state);
    let target = groups.find(
      (stack) =>
        stack.denomination === chip.denomination && stack.count < perStack,
    );
    if (!target) {
      const empty = Array.from({ length: slots }, (_, i) => i).filter(
        (slot) => !groups.some((stack) => stack.slot === slot),
      );
      const slot = empty.includes(preferred) ? preferred : empty[0];
      if (slot === undefined) return false;
      target = { slot, count: 0 };
    }
    chip.slot = target.slot;
    chip.level = chip.stackIndex = target.count;
    state.chips.push(chip);
    return true;
  }
  function compact(state, events) {
    for (const stack of stacks(state))
      for (const [level, chip] of stack.chips.entries()) {
        if (chip.level !== level) {
          events.moved.push({
            id: chip.id,
            from: { slot: chip.slot, level: chip.level },
            to: { slot: chip.slot, level },
          });
          chip.level = chip.stackIndex = level;
        }
      }
  }
  function remove(state, chip) {
    state.chips = state.chips.filter((item) => item.id !== chip.id);
  }
  function exchange(state, old, denominations, kind, events) {
    old.forEach((chip) => remove(state, chip));
    const added = denominations.map((denomination) =>
      issue(state, denomination),
    );
    compact(state, events);
    for (const chip of added) {
      if (!place(state, chip, old[0]?.slot))
        throw Error("Exchange has no physical stack space");
    }
    events.exchanges.push({
      id: `${state.routeId}:exchange:${state.serial}`,
      kind,
      amount: valueOf(old),
      removed: old.map(copyChip),
      added: added.map(copyChip),
      reserveDelta: 0,
    });
    return added;
  }
  function freeSlot(state, events) {
    const groups = stacks(state);
    // A small restack moves real chip identities; it does not repaint them.
    for (const from of [...groups].reverse()) {
      const to = groups.find(
        (other) =>
          other.slot !== from.slot &&
          other.denomination === from.denomination &&
          other.count + from.count <= perStack,
      );
      if (!to) continue;
      for (const chip of from.chips) {
        const old = { slot: chip.slot, level: chip.level };
        chip.slot = to.slot;
        chip.level = chip.stackIndex = to.count++;
        events.moved.push({
          id: chip.id,
          from: old,
          to: { slot: chip.slot, level: chip.level },
        });
      }
      events.exchanges.push({
        id: `${state.routeId}:restack:${state.serial++}`,
        kind: "restack",
        amount: valueOf(from.chips),
        removed: [],
        added: [],
        reserveDelta: 0,
      });
      return true;
    }
    // Exchange only when it actually frees a slot. A single lower stack can
    // merge into an existing higher stack; otherwise combine several complete
    // stacks. Exchanging one full stack for one new stack cannot create space.
    for (let index = 0; index < DENOMS.length - 1; index++) {
      const denomination = DENOMS[index],
        next = DENOMS[index + 1];
      const sources = groups.filter(
        (stack) => stack.denomination === denomination,
      );
      const available = groups
        .filter((stack) => stack.denomination === next)
        .reduce((n, stack) => n + perStack - stack.count, 0);
      for (let mask = 1; mask < 2 ** sources.length; mask++) {
        const selected = sources.filter((_, bit) => mask & (1 << bit));
        const amount = selected.reduce(
          (n, stack) => n + stack.count * denomination,
          0,
        );
        if (amount % next) continue;
        const count = amount / next;
        const needed = Math.ceil(Math.max(0, count - available) / perStack);
        if (needed >= selected.length) continue;
        exchange(
          state,
          selected.flatMap((stack) => stack.chips),
          Array(count).fill(next),
          "color-up",
          events,
        );
        return true;
      }
    }
    return false;
  }
  function arrive(state, chip, events, initial = false) {
    if (place(state, chip)) return;
    if (!initial && freeSlot(state, events) && place(state, chip)) return;
    state.reserveCents += chip.denomination;
    chip.slot = chip.level = chip.stackIndex = null;
    if (!initial)
      events.exchanges.push({
        id: `${chip.id}:vault`,
        kind: "vault",
        amount: chip.denomination,
        removed: [copyChip(chip)],
        added: [],
        reserveDelta: chip.denomination,
      });
  }
  function issueAmount(state, amount, events, initial = false) {
    const cash = amount % 100;
    state.reserveCents += cash;
    if (cash && !initial)
      events.exchanges.push({
        id: `${state.routeId}:cash:${state.serial++}`,
        kind: "cash-change",
        amount: cash,
        removed: [],
        added: [],
        reserveDelta: cash,
      });
    let remainder = amount - cash;
    if (initial && state.initialMode === "bank") {
      const basis = Math.min(amount, state.startingBank ?? amount);
      const primary = Math.max(
        0,
        DENOMS.findLastIndex((d) => d <= state.minBet),
      );
      for (const [denomination, weight, cap] of [
        [100, 0.01, 10],
        [DENOMS[primary], 0.09, 20],
        [DENOMS[Math.min(primary + 1, DENOMS.length - 1)], 0.4, 20],
      ]) {
        const existing = state.chips.filter(
          (chip) => chip.denomination === denomination,
        ).length;
        const count = Math.min(
          cap - existing,
          Math.floor((basis * weight) / denomination),
          Math.floor(remainder / denomination),
        );
        for (let i = 0; i < count; i++) {
          const chip = issue(state, denomination);
          arrive(state, chip, events, true);
          remainder -= denomination;
          events.added.push(chip);
        }
      }
    }
    // Bounded work even for million-dollar displays. At most slots × perStack chips
    // plus explicit reserve; no huge loop creating invisible virtual objects.
    const initialCeiling =
      initial && state.initialMode === "bank"
        ? Math.max(
            DENOMS[
              Math.min(
                DENOMS.findLastIndex((d) => d <= state.minBet) + 2,
                DENOMS.length - 1,
              )
            ],
            amount / 5,
          )
        : Infinity;
    for (const denomination of descending.filter((d) => d <= initialCeiling)) {
      let count = Math.floor(remainder / denomination);
      const limit = slots * perStack + 1;
      while (count-- > 0) {
        const chip = issue(state, denomination);
        arrive(state, chip, events, initial);
        events.added.push(chip);
        remainder -= denomination;
        if (events.added.length >= limit) {
          if (remainder && !initial)
            events.exchanges.push({
              id: `${state.routeId}:vault:${state.serial++}`,
              kind: "vault",
              amount: remainder,
              removed: [],
              added: [],
              reserveDelta: remainder,
            });
          state.reserveCents += remainder;
          remainder = 0;
          break;
        }
      }
      if (!remainder) break;
    }
  }
  function withdraw(state, amount, events, preferred = []) {
    let left = amount;
    const cash = amount % 100;
    if (cash && state.reserveCents < cash) {
      const change = [...state.chips].sort(
        (a, b) => a.denomination - b.denomination || b.level - a.level,
      )[0];
      if (!change) throw Error("Inventory cannot cover outgoing cash");
      remove(state, change);
      compact(state, events);
      const changeEvents = { ...events, added: [] };
      issueAmount(state, change.denomination - 100, changeEvents);
      state.reserveCents += 100;
      events.exchanges.push({
        id: `${change.id}:cash-change`,
        kind: "cash-change",
        amount: change.denomination,
        removed: [copyChip(change)],
        added: changeEvents.added.map(copyChip),
        reserveDelta: 100,
      });
    }
    if (cash) {
      state.reserveCents -= cash;
      events.reserveSpent += cash;
      left -= cash;
    }
    while (left > 0 && state.chips.length) {
      let selected = preferred
        .map((id) => state.chips.find((chip) => chip.id === id))
        .find((chip) => chip && chip.denomination <= left);
      selected ??= [...state.chips]
        .filter((chip) => chip.denomination <= left)
        .sort(
          (a, b) =>
            b.denomination - a.denomination ||
            b.level - a.level ||
            b.slot - a.slot,
        )[0];
      if (selected) {
        remove(state, selected);
        events.removed.push(copyChip(selected));
        left -= selected.denomination;
        continue;
      }
      const change = [...state.chips]
        .filter((chip) => chip.denomination > left)
        .sort(
          (a, b) => a.denomination - b.denomination || b.level - a.level,
        )[0];
      if (!change) break;
      const lower = DENOMS[DENOMS.indexOf(change.denomination) - 1];
      // Remove the note and issue its exact smaller-denomination value. Empty
      // slots are preferred; capacity exchanges remain explicit in the result.
      remove(state, change);
      compact(state, events);
      const children = Array(change.denomination / lower)
        .fill(null)
        .map(() => issue(state, lower));
      for (const chip of children) arrive(state, chip, events);
      events.exchanges.push({
        id: `${change.id}:change`,
        kind: "make-change",
        amount: change.denomination,
        removed: [copyChip(change)],
        added: children.map(copyChip),
        reserveDelta: 0,
      });
    }
    if (left) {
      if (left > state.reserveCents)
        throw Error("Inventory cannot cover outgoing amount");
      state.reserveCents -= left;
      events.reserveSpent += left;
    }
    compact(state, events);
  }
  function snapshotOf(state, events = {}) {
    const chips = state.chips.map(copyChip);
    return {
      routeId: state.routeId,
      amount: state.amount,
      total: state.amount,
      visibleAmount: valueOf(chips),
      reserveCents: state.reserveCents,
      revision: state.revision,
      chips,
      stacks: stacks({ ...state, chips }),
      added: (events.added ?? []).map(copyChip),
      removed: (events.removed ?? []).map(copyChip),
      exchanges: structuredClone(events.exchanges ?? []),
      moved: structuredClone(events.moved ?? []),
      reserveSpent: events.reserveSpent ?? 0,
      initial: events.initial ?? false,
    };
  }
  function validateChip(chip) {
    if (
      !chip ||
      typeof chip.id !== "string" ||
      !chip.id ||
      !DENOMS.includes(chip.denomination) ||
      !Number.isInteger(chip.wear) ||
      chip.wear < 0 ||
      chip.wear > 2
    )
      throw Error(
        "Incoming chips require a stable ID, real denomination and wear0–2",
      );
    const old = identities.get(chip.id);
    if (
      old &&
      (old.denomination !== chip.denomination || old.wear !== chip.wear)
    )
      throw Error("A physical chip cannot change denomination or wear");
  }
  function perform(routeId, amount, options = {}, preview = false) {
    if (typeof routeId !== "string" || !routeId)
      throw Error("Inventory route ID is required");
    cents(amount);
    if (options.startingBank !== undefined)
      cents(options.startingBank, "startingBank");
    if (options.minBet !== undefined) cents(options.minBet, "minBet");
    const old = routes.get(routeId),
      state = old ? clone(old) : fresh(routeId, options);
    const events = {
      added: [],
      removed: [],
      exchanges: [],
      moved: [],
      reserveSpent: 0,
      initial: !old,
    };
    const delta = amount - state.amount;
    if (!old && !options.incomingChips?.length)
      issueAmount(state, amount, events, true);
    else if (delta < 0)
      withdraw(state, -delta, events, options.outgoingChipIds);
    else if (delta > 0) {
      const incoming = options.incomingChips ?? [],
        ids = new Set();
      for (const chip of incoming) {
        validateChip(chip);
        if (ids.has(chip.id) || state.chips.some((old) => old.id === chip.id))
          throw Error("Incoming chip ID is duplicated");
        if (!preview)
          for (const [otherId, other] of routes)
            if (
              otherId !== routeId &&
              other.chips.some((old) => old.id === chip.id)
            )
              throw Error("Incoming chip still belongs to another route");
        ids.add(chip.id);
      }
      const value = valueOf(incoming);
      if (value > delta)
        throw Error("Incoming chips exceed the display balance delta");
      for (const source of incoming) {
        const chip = {
          id: source.id,
          denomination: source.denomination,
          wear: source.wear,
          ...(typeof source.appearanceId === "string"
            ? { appearanceId: source.appearanceId }
            : {}),
          slot: null,
          stackIndex: null,
          level: null,
        };
        arrive(state, chip, events);
        events.added.push(chip);
      }
      issueAmount(state, delta - value, events);
    }
    state.amount = amount;
    if (!old || delta) state.revision++;
    if (valueOf(state.chips) + state.reserveCents !== amount)
      throw Error("Display inventory value invariant failed");
    if (!preview) {
      routes.set(routeId, state);
      serials.set(routeId, state.serial);
      for (const chip of [...state.chips, ...events.added, ...events.removed])
        identities.set(chip.id, {
          denomination: chip.denomination,
          wear: chip.wear,
        });
    }
    return snapshotOf(state, events);
  }
  const api = {
    update: (id, amount, options) => perform(id, amount, options),
    previewUpdate: (id, amount, options) => perform(id, amount, options, true),
    previewSequence(operations) {
      const savedRoutes = new Map(routes),
        savedIdentities = new Map(identities),
        savedSerials = new Map(serials);
      try {
        return operations.map(({ routeId, amount, options }) =>
          perform(routeId, amount, options),
        );
      } finally {
        routes.clear();
        savedRoutes.forEach((value, key) => routes.set(key, value));
        identities.clear();
        savedIdentities.forEach((value, key) => identities.set(key, value));
        serials.clear();
        savedSerials.forEach((value, key) => serials.set(key, value));
      }
    },
    snapshot(id) {
      const state = routes.get(id);
      return state ? snapshotOf(state) : null;
    },
    spend(id, amount, options = {}) {
      cents(amount);
      const state = routes.get(id);
      if (!state || state.amount < amount)
        throw Error("Outgoing chips exceed route inventory");
      const result = perform(id, state.amount - amount, options);
      return { ...result, outgoingChips: result.removed };
    },
    previewSpend(id, amount, options = {}) {
      cents(amount);
      const state = routes.get(id);
      if (!state || state.amount < amount)
        throw Error("Outgoing chips exceed route inventory");
      const result = perform(id, state.amount - amount, options, true);
      return { ...result, outgoingChips: result.removed };
    },
    deposit(id, chips, options = {}) {
      const amount = options.amount ?? valueOf(chips);
      cents(amount);
      return perform(id, (routes.get(id)?.amount ?? 0) + amount, {
        ...options,
        initialMode: options.initialMode ?? "wager",
        incomingChips: chips,
      });
    },
    previewDeposit(id, chips, options = {}) {
      const amount = options.amount ?? valueOf(chips);
      cents(amount);
      return perform(
        id,
        (routes.get(id)?.amount ?? 0) + amount,
        {
          ...options,
          initialMode: options.initialMode ?? "wager",
          incomingChips: chips,
        },
        true,
      );
    },
    remove(id) {
      routes.delete(id);
    },
    resetRoom(key) {
      const next = String(key);
      if (next === roomKey) return false;
      roomKey = next;
      routes.clear();
      identities.clear();
      serials.clear();
      return true;
    },
    clear() {
      routes.clear();
      identities.clear();
      serials.clear();
    },
  };
  return api;
}
