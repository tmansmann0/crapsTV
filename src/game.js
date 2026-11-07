import {
  DEFAULT_GRAPHICS,
  mergeGraphics,
  normalizeGraphics,
} from "./graphics-settings.js";
import { validBetChoices } from "./bet-options.js";
import {
  createThrowTimeline,
  sanitizeGesture,
  THROW_DURATION,
} from "./throw-motion.js";

// Shared authoritative rules. All money is integer cents; no browser trusts another player's balance.
export const COLORS = [
  "#f2bd68",
  "#77c9b4",
  "#b9a0ee",
  "#f18c84",
  "#7db9ed",
  "#e8b8d6",
  "#c5d87c",
  "#f3a668",
];
export const WAYS = {
  2: 1,
  3: 2,
  4: 3,
  5: 4,
  6: 5,
  7: 6,
  8: 5,
  9: 4,
  10: 3,
  11: 2,
  12: 1,
};
export const POINTS = [4, 5, 6, 8, 9, 10];
export const ALL_POINTS = [2, 3, 4, 5, 6, 8, 9, 10, 11, 12];
export const money = (n) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: n % 100 ? 2 : 0,
  }).format(n / 100);
export const uid = () => globalThis.crypto.randomUUID();
export const randomDie = () => {
  const a = new Uint32Array(1);
  do {
    crypto.getRandomValues(a);
  } while (a[0] >= 4294967292);
  return (a[0] % 6) + 1;
};
const assert = (test, message) => {
  if (!test) throw new Error(message);
};
export function createState(code = "LOCAL") {
  return {
    code,
    status: "lobby",
    config: { mode: "craps", startingBank: 100000, minBet: 500, teach: false },
    display: {
      sound: false,
      camera: "auto",
      graphics: { ...DEFAULT_GRAPHICS },
      graphicsRevision: 0,
      revision: 0,
    },
    players: [],
    adminId: null,
    shooterId: null,
    point: null,
    rolling: false,
    aim: null,
    throw: null,
    rolls: [],
    lastRoll: null,
    log: [],
    createdAt: Date.now(),
    endedAt: null,
  };
}
export function equity(p) {
  return p.bank + p.bets.reduce((n, b) => n + b.amount, 0);
}
export function net(p) {
  return equity(p) - p.buyIn;
}
export function snapshot(state) {
  return structuredClone(state);
}
export function catalogue(state, player) {
  const crapless = state.config.mode === "crapless",
    point = state.point,
    points = crapless ? ALL_POINTS : POINTS;
  const lineChance = crapless ? 0.473087 : 0.492929;
  const rows = [
    {
      id: "pass",
      name: "Pass line",
      group: "The essentials",
      payout: "1:1",
      prob: point ? WAYS[point] / (WAYS[point] + 6) : lineChance,
      edge: crapless ? 5.382 : 1.414,
      description: crapless
        ? "Come-out 7 wins. Any other number becomes the point. Make it again before 7."
        : "Come-out 7 or 11 wins; 2, 3, 12 loses. Otherwise make the point before 7.",
      available: !point,
    },
    ...(!crapless
      ? [
          {
            id: "dont",
            name: "Don’t pass",
            group: "The essentials",
            payout: "1:1",
            prob: point ? 6 / (WAYS[point] + 6) : 0.479293,
            edge: 1.364,
            description:
              "Come-out 2 or 3 wins; 7 or 11 loses; 12 pushes. Then 7 wins before the point.",
            available: !point,
          },
        ]
      : []),
    {
      id: "come",
      name: "Come",
      group: "The essentials",
      payout: "1:1",
      prob: lineChance,
      edge: crapless ? 5.382 : 1.414,
      description:
        "Your own pass line: the next roll is its come-out, then it travels to its own number.",
      available: !!point,
    },
    ...(!crapless
      ? [
          {
            id: "dontcome",
            name: "Don’t come",
            group: "The essentials",
            payout: "1:1",
            prob: 0.479293,
            edge: 1.364,
            description:
              "Your own don’t pass: 12 pushes. Once it travels, 7 wins before its number.",
            available: !!point,
          },
        ]
      : []),
    {
      id: "field",
      name: "Field",
      group: "One roll",
      payout: "1:1 · 2 pays 2:1 · 12 pays 3:1",
      prob: 16 / 36,
      edge: 2.778,
      description:
        "Win on 2, 3, 4, 9, 10, 11 or 12. Resolves on the very next roll.",
      available: true,
    },
    ...points.map((n) => ({
      id: `place-${n}`,
      name: `Place ${n}`,
      group: "Place numbers",
      payout: [2, 12].includes(n)
        ? "11:2"
        : [3, 11].includes(n)
          ? "11:4"
          : [4, 10].includes(n)
            ? "9:5"
            : [5, 9].includes(n)
              ? "7:5"
              : "7:6",
      prob: WAYS[n] / (WAYS[n] + 6),
      edge: [2, 12].includes(n)
        ? 7.143
        : [3, 11].includes(n)
          ? 6.25
          : [4, 10].includes(n)
            ? 6.667
            : [5, 9].includes(n)
              ? 4
              : 1.515,
      description: `${n} before 7. Winnings paid; your stake stays up. Off on come-out rolls.`,
      available: true,
      quantum:
        ([2, 12].includes(n)
          ? 2
          : [3, 11].includes(n)
            ? 4
            : [6, 8].includes(n)
              ? 6
              : 5) * 100,
    })),
    ...[4, 6, 8, 10].map((n) => ({
      id: `hard-${n}`,
      name: `Hard ${n}`,
      group: "Hardways",
      payout: [4, 10].includes(n) ? "7:1" : "9:1",
      prob: 1 / (WAYS[n] + 6),
      edge: [4, 10].includes(n) ? 11.111 : 9.091,
      description: `Double ${n / 2}s before an easy ${n} or 7. Stake stays up on a win. Off on come-out.`,
      available: true,
    })),
    ...[2, 3, 7, 11, 12].map((n) => ({
      id: `prop-${n}`,
      name:
        n === 2
          ? "Snake eyes"
          : n === 12
            ? "Boxcars"
            : n === 11
              ? "Yo eleven"
              : `Any ${n}`,
      group: "One roll",
      payout: [2, 12].includes(n) ? "30:1" : n === 7 ? "4:1" : "15:1",
      prob: WAYS[n] / 36,
      edge: [2, 12].includes(n) ? 13.889 : n === 7 ? 16.667 : 11.111,
      description: `Win if the next roll totals ${n}. One roll only.`,
      available: true,
    })),
    {
      id: "craps",
      name: "Any craps",
      group: "One roll",
      payout: "7:1",
      prob: 4 / 36,
      edge: 11.111,
      description: "Win if the next roll is 2, 3 or 12. One roll only.",
      available: true,
    },
    ...[6, 8].map((n) => ({
      id: `big-${n}`,
      name: `Big ${n}`,
      group: "Big numbers",
      payout: "1:1",
      prob: 5 / 11,
      edge: 9.091,
      description: `${n} before 7. Always working, including come-out. A place bet pays more.`,
      available: true,
    })),
  ];
  if (player)
    for (const b of player.bets.filter(
      (b) => ["pass", "dont", "come", "dontcome"].includes(b.type) && b.point,
    )) {
      const against = ["dont", "dontcome"].includes(b.type),
        w = WAYS[b.point];
      rows.push({
        id: `odds:${b.id}`,
        name: `${against ? "Lay" : "Take"} odds · ${b.type === "pass" ? "pass" : b.type === "dont" ? "don’t pass" : b.type === "dontcome" ? "don’t come" : "come"} ${b.point}`,
        group: "True odds",
        payout: against ? `${w}:6` : `6:${w}`,
        prob: against ? 6 / (6 + w) : w / (6 + w),
        edge: 0,
        description: `Back your ${b.point} with true odds, up to 5× the line stake.${b.type === "come" ? " Off on come-out rolls." : ""}`,
        available: true,
        quantum: (against ? 6 : w) * 100,
        parent: b.id,
        max: b.amount * 5,
      });
    }
  return rows.map((b) => ({
    ...b,
    quantum: b.quantum || 100,
    minimum:
      Math.ceil(state.config.minBet / (b.quantum || 100)) * (b.quantum || 100),
  }));
}
// Active line bets use their own traveled point, independent of the table point.
export function describeBet(state, player, bet) {
  const info = catalogue(state, player).find(
    (item) => item.id === bet.type || item.id === `odds:${bet.parent}`,
  );
  if (
    !info ||
    !bet.point ||
    !["pass", "dont", "come", "dontcome"].includes(bet.type)
  )
    return info;
  const against = ["dont", "dontcome"].includes(bet.type);
  const ways = WAYS[bet.point];
  return { ...info, prob: against ? 6 / (ways + 6) : ways / (ways + 6) };
}

function log(s, text, type = "info") {
  s.log.unshift({ id: uid(), text, type, at: Date.now() });
  s.log = s.log.slice(0, 50);
}
export function join(s, name) {
  assert(s.status !== "ended", "This session has ended. Start a new table.");
  assert(
    s.players.filter((p) => !p.left).length < 12,
    "This table is full (12 players).",
  );
  name =
    typeof name === "string"
      ? name
          .trim()
          .replace(/[\u0000-\u001f\u007f]/g, "")
          .slice(0, 20)
      : "";
  assert(name.length > 0, "Give us a name for the table.");
  const p = {
    id: uid(),
    name,
    seat:
      Array.from({ length: 12 }, (_, i) => i).find(
        (i) => !s.players.some((p) => !p.left && p.seat === i),
      ) ?? 0,
    dice: { color: "red", finish: "solid" },
    betPreview: null,
    color: COLORS[s.players.length % COLORS.length],
    bank: s.config.startingBank,
    buyIn: s.config.startingBank,
    bets: [],
    connected: true,
    left: false,
    joinedAt: Date.now(),
    stats: {
      wins: 0,
      losses: 0,
      pushes: 0,
      reups: 0,
      biggestWin: 0,
      wagered: 0,
      rolls: 0,
      points: 0,
      streak: 0,
      bestStreak: 0,
    },
    history: [
      {
        roll: s.rolls.length,
        equity: s.config.startingBank,
        net: 0,
        event: "Joined",
      },
    ],
  };
  s.players.push(p);
  if (!s.adminId) s.adminId = p.id;
  if (!s.shooterId) s.shooterId = p.id;
  log(s, `${name} pulled up a chair.`, "player-joined");
  return p;
}
function active(s, id) {
  const p = s.players.find((p) => p.id === id && !p.left);
  assert(p, "Join the table first.");
  return p;
}
function admin(s, id) {
  assert(id === s.adminId, "Only the table host can do that.");
}
function betting(s) {
  assert(s.status === "playing", "The table isn’t taking bets yet.");
  assert(!s.rolling, "Dice are out. Wait for the next betting window.");
}
export function configure(s, id, changes) {
  admin(s, id);
  assert(s.status === "lobby", "Rules are set when the session starts.");
  const {
    startingBank = s.config.startingBank,
    minBet = s.config.minBet,
    mode = s.config.mode,
    teach = s.config.teach,
  } = changes;
  assert(["craps", "crapless"].includes(mode), "Choose craps or crapless.");
  assert(
    Number.isSafeInteger(startingBank) &&
      startingBank >= 1000 &&
      startingBank <= 100000000,
    "Starting chips must be $10–$1,000,000.",
  );
  assert(
    Number.isSafeInteger(minBet) && minBet >= 100 && minBet <= startingBank,
    "Minimum must be $1 or more and fit the starting stack.",
  );
  assert(typeof teach === "boolean", "Teach mode must be on or off.");
  s.config = { startingBank, minBet, mode, teach };
  for (const p of s.players) {
    p.bank = startingBank;
    p.buyIn = startingBank;
    p.history = [{ roll: 0, equity: startingBank, net: 0, event: "Joined" }];
  }
}
export function start(s, id) {
  admin(s, id);
  assert(s.status === "lobby", "This session has already started.");
  s.status = "playing";
  log(s, "Table is open. Place your bets!", "start");
}
export function setTeach(s, id, value) {
  admin(s, id);
  assert(typeof value === "boolean", "Invalid teach setting.");
  s.config.teach = value;
  if (value) log(s, "Teach mode is on.", "teach-mode");
}
export function previewBet(s, id, amount, betId = null, now = Date.now()) {
  const p = s.players.find((player) => player.id === id);
  assert(p, "Join the table first.");
  assert(
    Number.isSafeInteger(amount) && amount >= 0,
    "Invalid preview amount.",
  );
  if (amount === 0) {
    p.betPreview = null;
    return true;
  }
  active(s, id);
  betting(s);
  assert(amount <= p.bank, "Preview exceeds available chips.");
  assert(
    betId === null || typeof betId === "string",
    "Invalid preview target.",
  );
  const row =
    betId === null ? null : catalogue(s, p).find((row) => row.id === betId);
  assert(betId === null || row, "Unknown preview target.");
  if (p.betPreview && now - p.betPreview.at < 90) return false;
  p.betPreview = {
    amount,
    betId,
    valid: row ? validBetChoices(row, amount, p).valid : true,
    revision: (p.betPreview?.revision || 0) + 1,
    at: now,
  };
  return true;
}
export function place(s, id, betId, amount) {
  betting(s);
  const p = active(s, id),
    item = catalogue(s, p).find((b) => b.id === betId);
  assert(item && item.available, "That bet is not available on this roll.");
  assert(
    Number.isSafeInteger(amount) &&
      amount >= item.minimum &&
      amount % item.quantum === 0,
    `Bet at least ${money(item.minimum)}, in ${money(item.quantum)} increments.`,
  );
  assert(p.bank >= amount, "Not enough chips for that bet.");
  const existing = p.bets.find((b) =>
    item.parent ? b.parent === item.parent : b.type === betId && !b.point,
  );
  if (item.parent)
    assert(
      (existing?.amount || 0) + amount <= item.max,
      "Odds are limited to 5× the line stake.",
    );
  if (existing) existing.amount += amount;
  else
    p.bets.push({
      id: uid(),
      type: item.parent ? "odds" : betId,
      amount,
      point: item.parent
        ? p.bets.find((b) => b.id === item.parent).point
        : null,
      parent: item.parent || null,
    });
  p.bank -= amount;
  p.betPreview = null;
  p.stats.wagered += amount;
}
export function remove(s, id, betId) {
  betting(s);
  const p = active(s, id),
    b = p.bets.find((b) => b.id === betId);
  assert(b, "Bet not found.");
  assert(
    !(b.point && ["pass", "come"].includes(b.type)),
    "That line bet is locked until its point resolves.",
  );
  const removed = p.bets.filter((x) => x.id === b.id || x.parent === b.id);
  p.bank += removed.reduce((n, b) => n + b.amount, 0);
  p.bets = p.bets.filter((x) => !removed.includes(x));
}
export function reup(s, id) {
  betting(s);
  const p = active(s, id);
  assert(
    equity(p) < s.config.minBet,
    "Re-up after your stack falls below the table minimum.",
  );
  assert(!p.bets.length, "Take down your remaining bets before re-upping.");
  const added = s.config.startingBank - p.bank;
  p.bank = s.config.startingBank;
  p.buyIn += added;
  p.stats.reups++;
  p.history.push({
    roll: s.rolls.length,
    equity: equity(p),
    net: net(p),
    event: "Re-up",
  });
  log(s, `${p.name} is back in the game.`, "reup");
}
export function setDiceAppearance(s, id, appearance) {
  const p = active(s, id);
  assert(s.status !== "ended", "The session has ended.");
  assert(id === s.shooterId, "You can customize the dice on your turn.");
  assert(!s.rolling, "Wait until the dice have landed.");
  assert(
    appearance && typeof appearance === "object" && !Array.isArray(appearance),
    "Invalid dice appearance.",
  );
  // Merge independent choices against the authoritative state. A second tap
  // can arrive before the phone receives the first choice's state broadcast.
  const color =
    appearance.color === undefined ? p.dice.color : appearance.color;
  const finish =
    appearance.finish === undefined ? p.dice.finish : appearance.finish;
  assert(
    ["red", "green", "blue"].includes(color),
    "Choose red, green or blue dice.",
  );
  assert(
    ["solid", "translucent"].includes(finish),
    "Choose solid or translucent dice.",
  );
  p.dice = { color, finish };
}
export function setDisplaySettings(s, id, options) {
  admin(s, id);
  assert(
    options &&
      typeof options === "object" &&
      !Array.isArray(options) &&
      [Object.prototype, null].includes(Object.getPrototypeOf(options)),
    "Invalid display settings.",
  );
  assert(
    Reflect.ownKeys(options).every(
      (key) =>
        typeof key === "string" &&
        ["sound", "camera", "graphics"].includes(key),
    ),
    "Unknown display setting.",
  );
  const current = s.display || { sound: false, camera: "auto", revision: 0 };
  const sound = Object.hasOwn(options, "sound") ? options.sound : current.sound;
  const camera = Object.hasOwn(options, "camera")
    ? options.camera
    : current.camera;
  assert(typeof sound === "boolean", "Sound must be on or off.");
  assert(
    ["auto", "table", "room"].includes(camera),
    "Choose auto, table or room view.",
  );
  const graphics = Object.hasOwn(options, "graphics")
    ? mergeGraphics(current.graphics, options.graphics)
    : normalizeGraphics(current.graphics);
  s.display = {
    sound,
    camera,
    graphics,
    graphicsRevision:
      (current.graphicsRevision || 0) +
      (Object.hasOwn(options, "graphics") ? 1 : 0),
    revision: current.revision + 1,
  };
}

function throwController(s, id) {
  betting(s);
  active(s, id);
  assert(
    id === s.shooterId || id === s.adminId,
    "The shooter or host rolls the dice.",
  );
}
export function setAim(s, id, input, now = Date.now()) {
  throwController(s, id);
  assert(
    input && typeof input === "object" && !Array.isArray(input),
    "Invalid aim.",
  );
  assert(
    input.active === undefined || typeof input.active === "boolean",
    "Invalid aim state.",
  );
  const gesture = sanitizeGesture(input);
  if (input.active === false) {
    if (s.aim?.playerId === id) s.aim = null;
    return true;
  }
  // Authority-side cap supplements the phone's 100ms sending interval.
  if (s.aim?.playerId === id && now - s.aim.at < 100) return false;
  s.aim = { ...gesture, playerId: id, active: true, at: now };
  return true;
}
export function beginRoll(s, id, gesture, { duration = THROW_DURATION } = {}) {
  throwController(s, id);
  const controls = sanitizeGesture(
    gesture,
    s.aim?.playerId === id ? s.aim : undefined,
  );
  let timeline;
  for (let attempt = 0; attempt < 16; attempt++) {
    const seed = crypto.getRandomValues(new Uint32Array(1))[0];
    try {
      timeline = createThrowTimeline({
        id: uid(),
        playerId: id,
        shooterId: s.shooterId,
        seed,
        gesture: controls,
        startAt: 0,
        duration,
      });
      break;
    } catch (error) {
      // Only retry a physically cocked/off-table throw. No face value is ever
      // selected or used to accept/reject a valid landed throw.
      if (error.code !== "DICE_UNSETTLED") throw error;
    }
  }
  assert(timeline, "The dice did not settle. Please throw again.");
  timeline.startAt = Date.now();
  timeline.settledAt += timeline.startAt;
  s.throw = timeline;
  s.aim = null;
  s.rolling = true;
  for (const player of s.players) player.betPreview = null;
  return timeline;
}
function settle(p, b, result, multiplier = 1, stay = false) {
  if (result === "win") {
    const profit = Math.floor(b.amount * multiplier + 1e-7);
    p.bank += profit + (stay ? 0 : b.amount);
    p.stats.wins++;
    p.stats.biggestWin = Math.max(p.stats.biggestWin, profit);
    p.stats.streak++;
    p.stats.bestStreak = Math.max(p.stats.bestStreak, p.stats.streak);
  }
  if (result === "lose") {
    p.stats.losses++;
    p.stats.streak = 0;
  }
  if (result === "push") {
    p.bank += b.amount;
    p.stats.pushes++;
  }
  if (!stay || result !== "win") p.bets = p.bets.filter((x) => x.id !== b.id);
}
export function finishRoll(s, dice = s.throw?.dice) {
  assert(s.rolling, "No roll in progress.");
  assert(
    Array.isArray(dice) &&
      dice.length === 2 &&
      dice.every((n) => Number.isInteger(n) && n >= 1 && n <= 6),
    "Invalid dice.",
  );
  if (s.throw && dice.some((n, i) => n !== s.throw.dice[i])) {
    // Explicit dice are a trusted rules-test fixture, never accepted from the
    // wire. Drop the unrelated visual throw instead of manufacturing its faces.
    s.throw = null;
  }
  const total = dice[0] + dice[1],
    oldPoint = s.point,
    crapless = s.config.mode === "crapless";
  const events = [];
  for (const p of s.players.filter((p) => !p.left)) {
    const before = equity(p),
      pending = [...p.bets];
    // Capture labels while traveled parent bets are still present. Odds labels
    // depend on that parent, which may be removed by its settlement below.
    const labels = new Map(
      pending.map((bet) => [bet.id, describeBet(s, p, bet)?.name || bet.type]),
    );
    const settlements = [];
    const settleBet = (bet, result, multiplier = 1, stay = false) => {
      const beforeBet = equity(p);
      const amount = bet.amount;
      settle(p, bet, result, multiplier, stay);
      settlements.push({
        betId: bet.id,
        label: labels.get(bet.id),
        result,
        delta: equity(p) - beforeBet,
        amount,
      });
    };
    // Parent line outcomes determine odds outcomes, regardless of iteration order.
    const outcomes = new Map();
    for (const b of pending.filter((b) =>
      ["pass", "dont", "come", "dontcome"].includes(b.type),
    )) {
      const against = ["dont", "dontcome"].includes(b.type);
      let result = null;
      if (b.point) {
        if (total === b.point) result = against ? "lose" : "win";
        else if (total === 7) result = against ? "win" : "lose";
      } else if (against) {
        if ([7, 11].includes(total)) result = "lose";
        else if ([2, 3].includes(total)) result = "win";
        else if (total === 12) result = "push";
        else b.point = total;
      } else if (total === 7 || (!crapless && total === 11)) result = "win";
      else if (!crapless && [2, 3, 12].includes(total)) result = "lose";
      else b.point = total;
      if (result) {
        outcomes.set(b.id, result);
        settleBet(b, result);
      }
    }
    for (const b of pending.filter((b) => b.type === "odds")) {
      const parent = pending.find((x) => x.id === b.parent),
        result = outcomes.get(b.parent);
      if (!result) continue;
      if (!oldPoint && parent?.type === "come") {
        settleBet(b, "push");
        continue;
      }
      const against = ["dont", "dontcome"].includes(parent?.type);
      settleBet(b, result, against ? WAYS[b.point] / 6 : 6 / WAYS[b.point]);
    }
    for (const b of pending.filter(
      (b) => !["pass", "dont", "come", "dontcome", "odds"].includes(b.type),
    )) {
      const [kind, ns] = b.type.split("-"),
        n = Number(ns);
      if (["place", "hard"].includes(kind) && !oldPoint) continue;
      if (kind === "place") {
        if (total === 7) settleBet(b, "lose");
        else if (total === n) {
          const ratio = [2, 12].includes(n)
            ? 11 / 2
            : [3, 11].includes(n)
              ? 11 / 4
              : [4, 10].includes(n)
                ? 9 / 5
                : [5, 9].includes(n)
                  ? 7 / 5
                  : 7 / 6;
          settleBet(b, "win", ratio, true);
        }
      } else if (kind === "hard") {
        if (total === 7 || (total === n && dice[0] !== dice[1]))
          settleBet(b, "lose");
        else if (total === n)
          settleBet(b, "win", [4, 10].includes(n) ? 7 : 9, true);
      } else if (kind === "big") {
        if (total === 7) settleBet(b, "lose");
        else if (total === n) settleBet(b, "win", 1, true);
      } else if (kind === "prop")
        settleBet(
          b,
          total === n ? "win" : "lose",
          [2, 12].includes(n) ? 30 : n === 7 ? 4 : 15,
        );
      else if (b.type === "craps")
        settleBet(b, [2, 3, 12].includes(total) ? "win" : "lose", 7);
      else if (b.type === "field")
        settleBet(
          b,
          [2, 3, 4, 9, 10, 11, 12].includes(total) ? "win" : "lose",
          total === 2 ? 2 : total === 12 ? 3 : 1,
        );
    }
    p.stats.rolls++;
    const delta = equity(p) - before;
    if (settlements.length || delta)
      events.push({ playerId: p.id, name: p.name, delta, bets: settlements });
    p.history.push({
      roll: s.rolls.length + 1,
      equity: equity(p),
      net: net(p),
      event: `${dice[0]} + ${dice[1]}`,
    });
  }
  let kind = "roll",
    message = `${total}. Place your bets.`;
  if (!oldPoint) {
    if (total === 7 || (!crapless && total === 11)) {
      kind = "natural";
      message = `${total}! Natural winner.`;
    } else if (!crapless && [2, 3, 12].includes(total)) {
      kind = "craps";
      message = `${total}. Craps on the come-out.`;
    } else {
      s.point = total;
      kind = "point-set";
      message = `The point is ${total}. Let’s chase it.`;
    }
  } else if (total === oldPoint) {
    s.point = null;
    kind = "point-hit";
    message = `${total}! Point made. Same shooter.`;
    const p = s.players.find((p) => p.id === s.shooterId);
    if (p) p.stats.points++;
  } else if (total === 7) {
    s.point = null;
    kind = "seven-out";
    message = "Seven out. Pass the dice.";
    rotateShooter(s);
  }
  s.rolling = false;
  s.aim = null;
  s.lastRoll = {
    id: uid(),
    index: s.rolls.length + 1,
    dice,
    total,
    kind,
    message,
    events,
    pointBefore: oldPoint,
    throwId: s.throw?.id || null,
    at: Date.now(),
  };
  s.rolls.push(s.lastRoll);
  log(s, message, kind);
  return s.lastRoll;
}
export function rotateShooter(s) {
  const eligible = s.players.filter((p) => !p.left && p.connected);
  if (!eligible.length) {
    s.shooterId = null;
    return;
  }
  const i = eligible.findIndex((p) => p.id === s.shooterId);
  s.shooterId = eligible[(i + 1) % eligible.length].id;
}
export function leave(s, id) {
  assert(!s.rolling, "Wait for the dice to land before cashing out.");
  const p = active(s, id);
  p.bank = equity(p);
  p.bets = [];
  p.betPreview = null;
  p.left = true;
  p.connected = false;
  p.leftAt = Date.now();
  p.history.push({
    roll: s.rolls.length,
    equity: p.bank,
    net: net(p),
    event: "Cashed out",
  });
  if (s.adminId === id)
    s.adminId =
      s.players.find((x) => !x.left && x.connected)?.id ||
      s.players.find((x) => !x.left)?.id ||
      null;
  if (s.shooterId === id) rotateShooter(s);
  if (s.aim?.playerId === id) s.aim = null;
  log(s, `${p.name} cashed out with ${money(p.bank)}.`, "leave");
}
export function end(s, id) {
  admin(s, id);
  assert(s.status === "playing", "Start the session first.");
  assert(!s.rolling, "Wait for the dice to land before closing the table.");
  for (const p of s.players.filter((p) => !p.left)) {
    p.bank = equity(p);
    p.bets = [];
  }
  s.status = "ended";
  s.aim = null;
  for (const player of s.players) player.betPreview = null;
  s.endedAt = Date.now();
  log(s, "That’s a wrap. What a night.", "session-ended");
}
export function changeConnection(s, id, connected) {
  const p = s.players.find((x) => x.id === id);
  if (!p || p.left) return;
  p.connected = connected;
  if (!connected) p.betPreview = null;
  if (!connected && s.aim?.playerId === id) s.aim = null;
}
export function transfer(s, id, to) {
  admin(s, id);
  active(s, to);
  s.adminId = to;
  log(
    s,
    "Host controls passed to " + s.players.find((p) => p.id === to).name + ".",
  );
}
export function recap(p) {
  return {
    net: net(p),
    equity: equity(p),
    buyIn: p.buyIn,
    title:
      p.stats.reups >= 2
        ? "The comeback kid"
        : p.stats.points >= 3
          ? "The point collector"
          : net(p) > p.buyIn * 0.5
            ? "The high roller"
            : net(p) > 0
              ? "The smooth operator"
              : p.stats.bestStreak >= 3
                ? "The streak chaser"
                : "The table legend",
    winRate:
      p.stats.wins + p.stats.losses
        ? Math.round((p.stats.wins / (p.stats.wins + p.stats.losses)) * 100)
        : 0,
  };
}
