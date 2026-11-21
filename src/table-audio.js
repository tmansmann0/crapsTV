import {
  DEFAULT_TABLE_AUDIO,
  normalizeTableAudio,
} from "./table-audio-settings.js";

const ROOT = `${import.meta.env.BASE_URL}audio/table/`;
const STORAGE_KEY = "crapstv.table-audio";

const clips = {
  felt: ["felt-1", "felt-2"],
  rail: ["rail-1", "rail-2"],
  dice: ["dice-1", "dice-2"],
  puck: ["puck-1"],
  chips: ["chips-1", "chips-2"],
  lay: ["chip-lay-1", "chip-lay-2"],
  shuffle: ["chip-shuffle-1", "chip-shuffle-2"],
};
const freshImpactMs = 150;
const unit = (n) => Math.max(0, Math.min(1, n));

export function loadTableAudioSettings() {
  try {
    return normalizeTableAudio(JSON.parse(localStorage.getItem(STORAGE_KEY)));
  } catch {
    return { ...DEFAULT_TABLE_AUDIO };
  }
}

export function saveTableAudioSettings(settings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // The current display can still mix audio if browser storage is blocked.
  }
}

export function createTableAudio() {
  let context,
    effects,
    audition,
    settings = DEFAULT_TABLE_AUDIO,
    prepared,
    throwId,
    throwStart,
    nextContact = 0,
    liveThrowId,
    showingIntro = false,
    lastLandingAt = -Infinity,
    previewUntil = 0;
  const buffers = new Map();
  const loops = new Map();
  const lastHitAt = new Map();
  const liveSources = new Set();

  function setLoop(layer, name, volume) {
    const current = loops.get(layer);
    if (current && current.name !== name) {
      current.player.pause();
      current.player.removeAttribute("src");
      current.player.load();
      current.source.disconnect();
      current.gain.disconnect();
      loops.delete(layer);
    }
    if (!name) return;
    let loop = loops.get(layer);
    if (!loop) {
      const player = new Audio(`${ROOT}${name}.mp3`);
      player.loop = true;
      player.preload = "none";
      const source = context.createMediaElementSource(player);
      const gain = context.createGain();
      source.connect(gain).connect(context.destination);
      loop = { name, player, source, gain };
      loops.set(layer, loop);
    }
    loop.gain.gain.value = volume;
    if (volume > 0 && loop.player.paused) loop.player.play().catch(() => {});
    else if (!volume) loop.player.pause();
  }

  function configure(next) {
    settings = next;
    if (context?.state !== "running") return;
    effects.gain.value = settings.effects;
    audition.gain.value = settings.effects || DEFAULT_TABLE_AUDIO.effects;
    setLoop(
      "ambience",
      settings.ambience ? "room" : null,
      settings.ambience * 0.5,
    );
    setLoop(
      "music",
      settings.music === "off" ? null : settings.music,
      settings.musicVolume * 0.5,
    );
  }

  async function enable() {
    const AudioContext =
      globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AudioContext) return false;
    try {
      if (!context) {
        context = new AudioContext();
        effects = context.createGain();
        effects.connect(context.destination);
        audition = context.createGain();
        audition.connect(context.destination);
      }
      const session = context;
      if (session.state !== "running") await session.resume();
      if (context !== session || session.state !== "running") return false;
      configure(settings);
      prepared ??= Promise.all(
        Object.values(clips)
          .flat()
          .map(async (name) => {
            try {
              const response = await fetch(`${ROOT}${name}.mp3`);
              if (!response.ok) return;
              const buffer = await session.decodeAudioData(
                await response.arrayBuffer(),
              );
              if (context === session) buffers.set(name, buffer);
            } catch {
              // A failed sample does not silence the rest of the table.
            }
          }),
      );
      return true;
    } catch {
      return false;
    }
  }

  function play(
    kind,
    strength,
    x,
    when = context.currentTime,
    output = effects,
  ) {
    const variants = clips[kind];
    const buffer = buffers.get(
      variants[Math.floor(Math.random() * variants.length)],
    );
    if (!buffer) return;
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = 0.94 + Math.random() * 0.12;
    const gain = context.createGain();
    gain.gain.value = strength;
    source.connect(gain);
    if (context.createStereoPanner) {
      const pan = context.createStereoPanner();
      pan.pan.value = (unit(x / 11 + 0.5) - 0.5) * 1.2;
      gain.connect(pan).connect(output);
    } else gain.connect(output);
    source.start(when);
    return source;
  }

  function updateIntroThrow(roll, now, active) {
    showingIntro = active;
    if (!roll?.audioContacts?.length) return;
    if (roll.id !== throwId || roll.startAt !== throwStart) {
      throwId = roll.id;
      throwStart = roll.startAt;
      nextContact = 0;
      lastHitAt.clear();
    }
    const age = now - roll.startAt;
    while (nextContact < roll.audioContacts.length) {
      const contact = roll.audioContacts[nextContact];
      if (contact.time > age) break;
      nextContact++;
      if (
        age - contact.time > freshImpactMs ||
        context?.state !== "running" ||
        !settings.effects ||
        document.hidden ||
        !Object.hasOwn(clips, contact.material) ||
        contact.time - (lastHitAt.get(contact.material) ?? -Infinity) < 35
      )
        continue;
      lastHitAt.set(contact.material, contact.time);
      play(contact.material, 0.18 + 0.64 * unit(contact.speed / 6), contact.x);
    }
  }

  function clearLiveThrow() {
    for (const source of liveSources) source.stop();
    liveSources.clear();
  }

  function scheduleLiveThrow(roll, now) {
    if (!roll) {
      clearLiveThrow();
      return;
    }
    if (
      roll.id === liveThrowId ||
      showingIntro ||
      context?.state !== "running" ||
      document.hidden ||
      !roll.audioContacts?.length
    )
      return;
    clearLiveThrow();
    liveThrowId = roll.id;
    const elapsed = now - roll.startAt;
    const clock = context.currentTime;
    const lastHit = new Map();
    // Start from the same room clock as the visual throw, even when WebGL
    // misses a frame. Ignore contacts that already passed on this display.
    for (const contact of roll.audioContacts) {
      if (
        elapsed - contact.time > freshImpactMs ||
        !Object.hasOwn(clips, contact.material) ||
        contact.time - (lastHit.get(contact.material) ?? -Infinity) < 35
      )
        continue;
      lastHit.set(contact.material, contact.time);
      const source = play(
        contact.material,
        0.18 + 0.64 * unit(contact.speed / 6),
        contact.x,
        clock + Math.max(0, contact.time - elapsed) / 1000,
      );
      if (source) {
        liveSources.add(source);
        source.onended = () => liveSources.delete(source);
      }
    }
  }

  function chipLanding(count, x) {
    if (context?.state !== "running" || !settings.effects || document.hidden)
      return;
    if (context.currentTime - lastLandingAt < 0.055) return;
    lastLandingAt = context.currentTime;
    play(count > 1 ? "shuffle" : "lay", 0.66, x);
  }

  async function preview() {
    if (!(await enable())) return;
    const session = context;
    await prepared;
    if (context !== session || context.currentTime < previewUntil) return;
    // The audition stays available with the gameplay effects slider muted.
    const start = context.currentTime;
    const sounds = [
      ["felt", 0, -2.5],
      ["rail", 0.16, 3],
      ["dice", 0.29, 1],
      ["felt", 0.43, 0.5],
      ["puck", 0.6, 0],
      ["lay", 0.92, -1.5],
      ["shuffle", 1.26, 1.5],
    ];
    previewUntil = start + 2;
    for (const [kind, delay, x] of sounds)
      play(kind, 0.76, x, start + delay, audition);
  }

  function dispose() {
    clearLiveThrow();
    for (const layer of loops.keys()) setLoop(layer, null, 0);
    context?.close().catch(() => {});
    context = null;
    prepared = null;
    liveThrowId = undefined;
    showingIntro = false;
    buffers.clear();
    lastLandingAt = -Infinity;
    previewUntil = 0;
  }

  return {
    enable,
    configure,
    updateIntroThrow,
    scheduleLiveThrow,
    chipLanding,
    preview,
    dispose,
  };
}
