import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_GRAPHICS,
  GRAPHICS_OPTIONS,
  normalizeGraphics,
  mergeGraphics,
} from "../src/graphics-settings.js";
import * as game from "../src/game.js";

test("graphics default to Auto and advertised options round-trip as exact wire values", () => {
  assert.deepEqual(normalizeGraphics(), {
    fps: "auto",
    antialias: "auto",
    resolution: "auto",
    modelDetail: "auto",
    textures: "auto",
    lensFlares: "auto",
    localReflections: "auto",
    contactShadows: "auto",
  });
  assert(Object.isFrozen(DEFAULT_GRAPHICS));
  for (const [key, options] of Object.entries(GRAPHICS_OPTIONS))
    for (const { value, label } of options) {
      assert.equal(normalizeGraphics({ [key]: value })[key], value);
      assert.equal(typeof label, "string");
      assert(label.length > 0);
    }
});

test("partial graphics updates preserve all prior choices without mutating their input", () => {
  const current = normalizeGraphics({ fps: 30, resolution: "150" });
  const before = { ...current };
  const changed = mergeGraphics(current, { textures: "1k", antialias: "off" });
  assert.deepEqual(current, before);
  assert.deepEqual(changed, {
    fps: 30,
    resolution: "150",
    textures: "1k",
    antialias: "off",
    modelDetail: "auto",
    lensFlares: "auto",
    localReflections: "auto",
    contactShadows: "auto",
  });
  assert.deepEqual(mergeGraphics(undefined, {}), DEFAULT_GRAPHICS);
});

test("graphics reject malformed records, unknown keys and invalid option types", () => {
  for (const malformed of [
    null,
    [],
    60,
    "auto",
    new Date(),
    Object.create({ fps: 60 }),
  ])
    assert.throws(() => normalizeGraphics(malformed));
  for (const patch of [
    { fps: "60" },
    { fps: 120 },
    { fps: null },
    { fps: undefined },
    { antialias: true },
    { antialias: "yes" },
    { resolution: 100 },
    { resolution: "50" },
    { modelDetail: "low" },
    { textures: 1024 },
    { textures: "8k" },
    { lensFlares: true },
    { localReflections: "balanced" },
    { contactShadows: 1 },
    { fps: 60, unknown: "auto" },
    JSON.parse('{"__proto__":{"polluted":true}}'),
    { [Symbol("fps")]: 60 },
  ])
    assert.throws(() => mergeGraphics(DEFAULT_GRAPHICS, patch));
  assert.equal({}.polluted, undefined);
});

test("room graphics are independent, admin-only and atomic with display updates", () => {
  const state = game.createState("GRAPHX");
  const a = game.join(state, "Admin"),
    b = game.join(state, "Guest");
  const other = game.createState("OTHERX");
  assert.deepEqual(state.display.graphics, DEFAULT_GRAPHICS);
  assert.notEqual(state.display.graphics, other.display.graphics);
  assert.throws(() =>
    game.setDisplaySettings(state, b.id, { graphics: { fps: 60 } }),
  );
  game.setDisplaySettings(state, a.id, { graphics: { fps: 30 } });
  game.setDisplaySettings(state, a.id, {
    sound: true,
    graphics: { textures: "2k" },
  });
  assert.equal(state.display.revision, 2);
  assert.deepEqual(state.display.graphics, {
    ...DEFAULT_GRAPHICS,
    fps: 30,
    textures: "2k",
  });
  assert.equal(state.display.sound, true);
  assert.deepEqual(other.display.graphics, DEFAULT_GRAPHICS);
  const before = structuredClone(state.display);
  for (const invalid of [
    { sound: false, graphics: { fps: 144 } },
    { graphics: null },
    { graphics: undefined },
    { camera: "table", graphics: { bad: "value" } },
    { revision: 1000 },
    { unknown: true },
    { sound: null },
    { camera: null },
    { sound: undefined },
  ]) {
    assert.throws(() => game.setDisplaySettings(state, a.id, invalid));
    assert.deepEqual(state.display, before);
  }
});

test("optional lighting switches are admin-only and leave play and the roll deadline untouched", () => {
  const state = game.createState("FXROOM");
  const admin = game.join(state, "Admin"),
    guest = game.join(state, "Guest");
  const effects = {
    lensFlares: "on",
    localReflections: "on",
    contactShadows: "on",
  };
  const before = structuredClone(state);
  assert.throws(() =>
    game.setDisplaySettings(state, guest.id, { graphics: effects }),
  );
  assert.deepEqual(state, before);
  game.setDisplaySettings(state, admin.id, { graphics: effects });
  const after = structuredClone(state);
  delete before.display;
  delete after.display;
  assert.deepEqual(after, before);
  for (const key of Object.keys(effects))
    assert.equal(state.display.graphics[key], "on");
});

test("legacy display state receives automatic graphics without losing sound or camera", () => {
  const state = game.createState();
  const p = game.join(state, "Admin");
  state.display = { sound: true, camera: "room", revision: 3 };
  game.setDisplaySettings(state, p.id, { graphics: { resolution: "75" } });
  assert.equal(state.display.sound, true);
  assert.equal(state.display.camera, "room");
  assert.equal(state.display.revision, 4);
  assert.deepEqual(state.display.graphics, {
    ...DEFAULT_GRAPHICS,
    resolution: "75",
  });
});

test("graphics revision tracks successful graphics intent independently of sound and camera", () => {
  const state = game.createState();
  const admin = game.join(state, "Admin");
  assert.equal(state.display.graphicsRevision, 0);
  game.setDisplaySettings(state, admin.id, { sound: true });
  game.setDisplaySettings(state, admin.id, { camera: "room" });
  assert.equal(state.display.graphicsRevision, 0);
  assert.equal(state.display.revision, 2);
  game.setDisplaySettings(state, admin.id, { graphics: { fps: "auto" } });
  assert.equal(state.display.graphicsRevision, 1);
  game.setDisplaySettings(state, admin.id, { graphics: { fps: "auto" } });
  assert.equal(state.display.graphicsRevision, 2);
  assert.equal(state.display.revision, 4);
  const before = structuredClone(state.display);
  assert.throws(() =>
    game.setDisplaySettings(state, admin.id, { graphics: { fps: 120 } }),
  );
  assert.deepEqual(state.display, before);
});

test("legacy saved effect On/Off preferences survive the new Auto defaults", () => {
  const legacy = {
    lensFlares: "off",
    localReflections: "on",
    contactShadows: "off",
  };
  assert.deepEqual(normalizeGraphics(legacy), {
    ...DEFAULT_GRAPHICS,
    ...legacy,
  });
});
