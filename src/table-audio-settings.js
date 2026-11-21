export const MUSIC_TRACKS = {
  off: "Off",
  moil: "Moil · Jazz",
  ladada: "LaDaDa Guitar · Acoustic",
  bossa: "Bossa Nova · Chiptune",
};

export const DEFAULT_TABLE_AUDIO = {
  effects: 0.75,
  ambience: 0,
  music: "off",
  musicVolume: 0.4,
};

export function normalizeTableAudio(saved) {
  const level = (key) =>
    Number.isFinite(saved?.[key])
      ? Math.max(0, Math.min(1, saved[key]))
      : DEFAULT_TABLE_AUDIO[key];
  return {
    effects: level("effects"),
    ambience: level("ambience"),
    music: Object.hasOwn(MUSIC_TRACKS, saved?.music) ? saved.music : "off",
    musicVolume: level("musicVolume"),
  };
}

export function mergeTableAudio(current, changes) {
  if (!changes || typeof changes !== "object" || Array.isArray(changes))
    throw Error("Invalid table audio settings.");
  for (const key of Reflect.ownKeys(changes)) {
    if (!Object.hasOwn(DEFAULT_TABLE_AUDIO, key))
      throw Error("Unknown table audio setting.");
    const value = changes[key];
    if (key === "music") {
      if (typeof value !== "string" || !Object.hasOwn(MUSIC_TRACKS, value))
        throw Error("Choose a music track from the list.");
    } else if (!Number.isFinite(value) || value < 0 || value > 1) {
      throw Error("Volume must be between 0% and 100%.");
    }
  }
  return { ...normalizeTableAudio(current), ...changes };
}
