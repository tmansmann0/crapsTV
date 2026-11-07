import test from "node:test";
import assert from "node:assert/strict";
import {
  recommendGraphics,
  calibrateGraphics,
  resolveGraphics,
} from "../src/graphics-profile.js";

const gpu = {
  devicePixelRatio: 2,
  deviceMemory: 8,
  hardwareConcurrency: 8,
  maxTextureSize: 16384,
};

test("GPU recommendations cap effective DPR at 1.5 and keep automatic LOD", () => {
  const profile = recommendGraphics(gpu);
  assert.deepEqual(profile, {
    fps: 60,
    resolutionScale: 0.75,
    antialias: true,
    modelDetail: "auto",
    textureLimit: 2048,
  });
  assert.equal(resolveGraphics({}, profile, gpu).pixelRatio, 1.5);
  assert.equal(
    recommendGraphics({ ...gpu, devicePixelRatio: 1 }).resolutionScale,
    1,
  );
  assert.equal(
    resolveGraphics({}, recommendGraphics({ ...gpu, maxTextureSize: 1024 }), {
      ...gpu,
      maxTextureSize: 1024,
    }).textureLimit,
    1024,
  );
  assert.equal(
    resolveGraphics({ textures: "2k" }, profile, {
      ...gpu,
      maxTextureSize: 512,
    }).textureLimit,
    512,
  );
});

test("reported low memory and software receive conservative initial settings", () => {
  const low = recommendGraphics({ ...gpu, deviceMemory: 4 });
  assert.deepEqual(low, {
    fps: 60,
    resolutionScale: 0.5,
    antialias: false,
    modelDetail: "optimized",
    textureLimit: 1024,
  });
  const software = recommendGraphics({ ...gpu, software: true });
  assert.deepEqual(software, {
    fps: 24,
    resolutionScale: 0.35,
    antialias: false,
    modelDetail: "optimized",
    textureLimit: 1024,
  });
  assert.equal(
    recommendGraphics({ ...gpu, hardwareConcurrency: 2 }).modelDetail,
    "optimized",
  );
});

test("manual overrides persist even when the automatic profile was lowered", () => {
  const auto = calibrateGraphics(recommendGraphics(gpu), Array(30).fill(45));
  const requested = {
    fps: 60,
    resolution: "200",
    antialias: "on",
    modelDetail: "full",
    textures: "native",
  };
  assert.deepEqual(resolveGraphics(requested, auto, gpu), {
    fps: 60,
    pixelRatio: 4,
    resolutionScale: 2,
    antialias: true,
    modelDetail: "full",
    textureLimit: 16384,
  });
  assert.equal(
    resolveGraphics({ textures: "1k", antialias: "off" }, auto, gpu)
      .textureLimit,
    1024,
  );
  assert.equal(
    resolveGraphics({ textures: "2k" }, auto, { ...gpu, maxTextureSize: 1500 })
      .textureLimit,
    1500,
  );
  assert.equal(
    resolveGraphics({ antialias: "off" }, auto, gpu).antialias,
    false,
  );
});

test("calibration uses P80 to lower scale and choose FPS without changing AA", () => {
  const initial = recommendGraphics(gpu);
  const slow = calibrateGraphics(initial, Array(60).fill(25));
  assert.equal(slow.fps, 30);
  assert(Math.abs(slow.resolutionScale - 0.6) < 1e-9);
  assert.equal(slow.antialias, initial.antialias);
  const verySlow = calibrateGraphics(
    { ...initial, antialias: false },
    Array(60).fill(45),
  );
  assert.equal(verySlow.fps, 24);
  assert.equal(verySlow.antialias, false);
  const fast = calibrateGraphics(slow, Array(60).fill(16.7));
  assert.equal(fast.fps, 60);
  assert.equal(fast.resolutionScale, slow.resolutionScale); // never auto-upscale
  const tiny = { ...initial, resolutionScale: 0.2 };
  assert.equal(
    calibrateGraphics(tiny, Array(20).fill(45)).resolutionScale,
    0.2,
  ); // never increase to floor
});

test("empty, sparse, invalid and occasional noisy timings do not corrupt the profile", () => {
  const profile = recommendGraphics(gpu);
  for (const samples of [
    undefined,
    null,
    [],
    [0, -1, NaN, Infinity],
    Array(4).fill(45),
  ])
    assert.deepEqual(calibrateGraphics(profile, samples), profile);
  const noisy = [
    ...Array(40).fill(16.7),
    ...Array(4).fill(60),
    900,
    -10,
    NaN,
    Infinity,
    "16",
  ];
  assert.deepEqual(calibrateGraphics(profile, noisy), profile);
  assert.equal(
    calibrateGraphics(profile, new Float32Array(20).fill(18)).fps,
    60,
  );
  assert.deepEqual(profile, recommendGraphics(gpu));
});

test("unknown capabilities are safe and invalid manual settings still reject", () => {
  const settings = resolveGraphics({}, undefined, {
    devicePixelRatio: NaN,
    deviceMemory: -1,
    maxTextureSize: Infinity,
  });
  assert.equal(settings.pixelRatio, 1);
  assert.equal(settings.textureLimit, 2048);
  assert(Number.isFinite(settings.resolutionScale));
  assert.throws(() => resolveGraphics({ fps: "60" }, undefined, gpu));
});
