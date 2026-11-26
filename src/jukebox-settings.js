export const MAX_JUKEBOX_QUEUE = 20;
export const MAX_SONG_COST = 100_000_000;
export const DEFAULT_JUKEBOX_SETTINGS = Object.freeze({
  enabled: false,
  cost: 500,
  limit: 3,
  mode: "open",
});

function valid(key, value) {
  if (key === "enabled") return typeof value === "boolean";
  if (key === "cost")
    return Number.isSafeInteger(value) && value >= 0 && value <= MAX_SONG_COST;
  if (key === "limit")
    return Number.isInteger(value) && value >= 1 && value <= MAX_JUKEBOX_QUEUE;
  return key === "mode" && ["open", "approval", "off"].includes(value);
}

export function restoreJukeboxSettings(saved) {
  const settings = { ...DEFAULT_JUKEBOX_SETTINGS };
  for (const key of Object.keys(settings)) {
    if (valid(key, saved?.[key])) settings[key] = saved[key];
  }
  return settings;
}

export function updateJukeboxSettings(current, patch) {
  if (!patch || typeof patch !== "object" || Array.isArray(patch))
    throw Error("Choose valid music settings.");
  for (const [key, value] of Object.entries(patch)) {
    if (!valid(key, value)) throw Error("Choose valid music settings.");
  }
  return { ...current, ...patch };
}
