import test from "node:test";
import assert from "node:assert/strict";
import {
  GRAPHICS_CALIBRATION_STORAGE,
  readGraphicsCalibration,
  writeGraphicsCalibration,
} from "../src/graphics-calibration-store.js";
import { resolveGraphics } from "../src/graphics-profile.js";
const profile = {
  fps: 60,
  resolutionScale: 0.82,
  antialias: true,
  modelDetail: "auto",
  textureLimit: 2048,
};
const capabilities = {
  devicePixelRatio: 1,
  viewportWidth: 1920,
  viewportHeight: 1080,
  software: false,
  maxTextureSize: 16384,
  deviceMemory: 8,
  hardwareConcurrency: 8,
};
function fixture() {
  const data = new Map();
  const storage = {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, value),
  };
  return {
    data,
    options: { storage, capabilities, rendererName: "Stable test GPU" },
  };
}
test("a completed Auto profile survives reload independently of room state and manual preferences", () => {
  const { data, options } = fixture();
  assert.equal(readGraphicsCalibration(options), null);
  assert.equal(
    writeGraphicsCalibration(profile, { ...options, now: 123 }),
    true,
  );
  const loaded = readGraphicsCalibration(options);
  assert.deepEqual(loaded, { profile, savedAt: 123 });
  loaded.profile.fps = 24;
  assert.equal(readGraphicsCalibration(options).profile.fps, 60);
  const record = JSON.parse(data.get(GRAPHICS_CALIBRATION_STORAGE));
  assert.deepEqual(Object.keys(record).sort(), [
    "device",
    "profile",
    "savedAt",
    "version",
  ]);
  assert.equal(
    data.size,
    1,
    "No tokens, balances, room settings or manual preferences are stored",
  );
});
test("manual choices always override a restored Auto profile", () => {
  const { options } = fixture();
  writeGraphicsCalibration(profile, options);
  const selected = readGraphicsCalibration(options).profile;
  const resolved = resolveGraphics(
    {
      fps: 30,
      antialias: "off",
      resolution: "75",
      textures: "1k",
      modelDetail: "full",
      lensFlares: "off",
      localReflections: "on",
      contactShadows: "off",
    },
    selected,
    capabilities,
  );
  assert.equal(resolved.fps, 30);
  assert.equal(resolved.resolutionScale, 0.75);
  assert.equal(resolved.antialias, false);
  assert.equal(resolved.textureLimit, 1024);
  assert.equal(resolved.modelDetail, "full");
  assert.equal(resolved.localReflections, true);
  assert.deepEqual(readGraphicsCalibration(options).profile, profile);
});
test("ordinary resizes, smaller displays, and improved limits reuse a stable calibration", () => {
  const { options } = fixture();
  writeGraphicsCalibration(profile, options);
  for (const patch of [
    { viewportWidth: 2000, viewportHeight: 1200 },
    { viewportWidth: 1280, viewportHeight: 720 },
    { maxTextureSize: 32768 },
    { deviceMemory: 16 },
    { hardwareConcurrency: 16 },
  ])
    assert.deepEqual(
      readGraphicsCalibration({
        ...options,
        capabilities: { ...capabilities, ...patch },
      }).profile,
      profile,
    );
});
test("material changes in hardware or rendering workload invalidate Auto without touching saved preferences", () => {
  const { options, data } = fixture();
  writeGraphicsCalibration(profile, options);
  const original = data.get(GRAPHICS_CALIBRATION_STORAGE);
  for (const patch of [
    { software: true },
    { maxTextureSize: 1024 },
    { viewportWidth: 3840, viewportHeight: 2160 },
    { devicePixelRatio: 2 },
    { deviceMemory: 4 },
    { hardwareConcurrency: 2 },
  ])
    assert.equal(
      readGraphicsCalibration({
        ...options,
        capabilities: { ...capabilities, ...patch },
      }),
      null,
    );
  assert.equal(
    readGraphicsCalibration({ ...options, rendererName: "Different GPU" }),
    null,
  );
  assert.equal(
    data.get(GRAPHICS_CALIBRATION_STORAGE),
    original,
    "Read-only invalidation does not erase the old profile or preferences",
  );
});
test("missing GPU extensions and memory hints do not invalidate a usable display", () => {
  const { options } = fixture();
  const unknown = {
    ...options,
    rendererName: "WebGL device",
    capabilities: {
      ...capabilities,
      deviceMemory: undefined,
      hardwareConcurrency: undefined,
    },
  };
  writeGraphicsCalibration(profile, unknown);
  assert.deepEqual(readGraphicsCalibration(unknown).profile, profile);
  assert.deepEqual(
    readGraphicsCalibration({ ...unknown, rendererName: "Known GPU" }).profile,
    profile,
  );
});
test("explicit successful retesting replaces the saved result; incomplete data cannot overwrite it", () => {
  const { options } = fixture();
  writeGraphicsCalibration(profile, options);
  const next = {
    ...profile,
    fps: 30,
    resolutionScale: 0.52,
    textureLimit: 1024,
  };
  assert.equal(writeGraphicsCalibration(next, { ...options, now: 456 }), true);
  assert.deepEqual(readGraphicsCalibration(options), {
    profile: next,
    savedAt: 456,
  });
  for (const bad of [
    { ...next, fps: 120 },
    { ...next, textureLimit: 16384 },
    { ...next, modelDetail: "full" },
    { ...next, resolutionScale: NaN },
  ])
    assert.equal(writeGraphicsCalibration(bad, options), false);
  assert.deepEqual(readGraphicsCalibration(options).profile, next);
});
test("corrupt, unsupported and blocked storage fall back without throwing", () => {
  const { options, data } = fixture();
  for (const value of [
    "{",
    "null",
    "[]",
    "{}",
    '{"version":99,"profile":{}}',
  ]) {
    data.set(GRAPHICS_CALIBRATION_STORAGE, value);
    assert.equal(readGraphicsCalibration(options), null);
  }
  const blocked = {
    ...options,
    storage: {
      getItem() {
        throw Error("blocked");
      },
      setItem() {
        throw Error("full");
      },
    },
  };
  assert.equal(readGraphicsCalibration(blocked), null);
  assert.equal(writeGraphicsCalibration(profile, blocked), false);
  assert.equal(readGraphicsCalibration({ capabilities }), null);
});
