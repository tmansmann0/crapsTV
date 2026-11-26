import { createState } from "./game.js";
import { botPersonalityOptions } from "./bot-options.js";
import { DEFAULT_DRINKING_RULES } from "./drinking-mode.js";
import { normalizeHouseRules } from "./house-rules.js";
import { normalizeGraphics } from "./graphics-settings.js";
import { puckHome } from "./puck-layout.js";
import { normalizeTableAudio } from "./table-audio-settings.js";

const VERSION = 1;
const isRecord = (value) =>
  value && typeof value === "object" && !Array.isArray(value);
const milliseconds = (value) =>
  Number.isFinite(value) ? Math.max(0, value) : 0;

function withoutMotion(state) {
  state.aim = null;
  state.throw = null;
  state.nextRollAt = null;
  state.botRollAt = null;
  for (const player of state.players) player.betPreview = null;
  return state;
}

export function captureRoomSave(
  state,
  tokens,
  completedBots,
  now = Date.now(),
) {
  return {
    version: VERSION,
    state: withoutMotion({ ...structuredClone(state), pausedAt: now }),
    tokens: [...tokens],
    completedBots,
    bettingRemainingMs: milliseconds((state.nextRollAt ?? now) - now),
  };
}

export function readRoomSave(serialized) {
  if (serialized == null) return null;
  let save;
  try {
    save = JSON.parse(serialized);
  } catch {
    throw Error("The saved table could not be read.");
  }
  if (!isRecord(save)) throw Error("The saved table could not be read.");
  const version = save.version ?? 0;
  if (version !== 0 && version !== VERSION)
    throw Error("This saved table requires a newer version of CrapsTV.");

  const previous = save.state;
  if (
    !isRecord(previous) ||
    !/^[A-Z2-9]{6}$/.test(previous.code) ||
    !["lobby", "playing"].includes(previous.status) ||
    previous.rolling ||
    !isRecord(previous.config) ||
    !Array.isArray(previous.players) ||
    !Array.isArray(previous.rolls) ||
    !Array.isArray(save.tokens) ||
    previous.players.some(
      (player) =>
        !isRecord(player) ||
        typeof player.id !== "string" ||
        !Array.isArray(player.bets),
    )
  )
    throw Error("The saved table could not be read.");

  const defaults = createState(previous.code);
  const tokenEntries = save.tokens.filter(
    (entry) =>
      Array.isArray(entry) &&
      entry.length === 2 &&
      typeof entry[0] === "string" &&
      previous.players.some(
        (player) => player.id === entry[1] && !player.bot && !player.left,
      ),
  );
  const host = previous.players.find(
    (player) => player.id === previous.adminId && !player.bot && !player.left,
  );
  if (!host || !tokenEntries.some(([, id]) => id === host.id))
    throw Error("The saved table is missing its host session.");

  const config = { ...defaults.config, ...previous.config };
  config.houseRules = normalizeHouseRules(previous.config.houseRules);
  if (config.drinkingMode)
    config.drinkingRules = {
      ...DEFAULT_DRINKING_RULES,
      ...config.drinkingRules,
    };
  const display = { ...defaults.display, ...previous.display };
  display.graphics = normalizeGraphics(display.graphics);
  if (display.audio) display.audio = normalizeTableAudio(display.audio);
  const pausedAt =
    Number.isFinite(previous.pausedAt) && previous.pausedAt > 0
      ? previous.pausedAt
      : Date.now();
  const puck = puckHome(previous.point, config.mode);
  if (previous.puck?.point === puck.point) {
    if (
      Array.isArray(previous.puck.position) &&
      previous.puck.position.length === 3 &&
      previous.puck.position.every(Number.isFinite)
    )
      puck.position = previous.puck.position;
    if (
      Array.isArray(previous.puck.quaternion) &&
      previous.puck.quaternion.length === 4 &&
      previous.puck.quaternion.every(Number.isFinite)
    )
      puck.quaternion = previous.puck.quaternion;
  }
  const state = withoutMotion({
    ...defaults,
    ...previous,
    config,
    display,
    physicsVersion: defaults.physicsVersion,
    puck,
    players: previous.players.map((player) => ({
      ...player,
      ...(player.bot && { bot: botPersonalityOptions(player.bot) }),
      dice: { color: "red", finish: "solid", ...player.dice },
      connected: !!player.bot && !player.left,
    })),
    pausedAt,
  });
  return {
    state,
    tokens: tokenEntries,
    completedBots: Array.isArray(save.completedBots) ? save.completedBots : [],
    bettingRemainingMs: milliseconds(
      save.bettingRemainingMs ?? (previous.nextRollAt ?? pausedAt) - pausedAt,
    ),
  };
}
