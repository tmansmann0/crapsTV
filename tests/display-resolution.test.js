import test from "node:test";
import assert from "node:assert/strict";
import {
  automaticRenderScale,
  planDisplayBuffers,
} from "../src/display-resolution.js";
import { recommendGraphics, resolveGraphics } from "../src/graphics-profile.js";

test("Auto starts at actual 1080p or 4K regardless of OS display scaling", () => {
  for (const [width, height, dpr, output] of [
    [1920, 1080, 1, [1920, 1080]],
    [3840, 2160, 1, [3840, 2160]],
    [1920, 1080, 2, [3840, 2160]],
    [2560, 1440, 1.5, [3840, 2160]],
  ]) {
    const capabilities = {
      viewportWidth: width,
      viewportHeight: height,
      devicePixelRatio: dpr,
    };
    const quality = resolveGraphics(
      {},
      recommendGraphics(capabilities),
      capabilities,
    );
    const plan = planDisplayBuffers({
      width,
      height,
      devicePixelRatio: dpr,
      scenePixelRatio: quality.pixelRatio,
    });
    assert.deepEqual([plan.sceneWidth, plan.sceneHeight], output);
    assert.deepEqual([plan.uiWidth, plan.uiHeight], output);
    assert.equal(plan.split, false);
  }
});

test("75% 3D keeps 4K UI pixels and supersampling resolves back to native UI", () => {
  const base = { width: 1920, height: 1080, devicePixelRatio: 2 };
  const scaled = planDisplayBuffers({ ...base, scenePixelRatio: 1.5 });
  assert.deepEqual([scaled.sceneWidth, scaled.sceneHeight], [2880, 1620]);
  assert.deepEqual([scaled.uiWidth, scaled.uiHeight], [3840, 2160]);
  assert.equal(scaled.split, true);
  const superSampled = planDisplayBuffers({ ...base, scenePixelRatio: 3 });
  assert.deepEqual(
    [superSampled.sceneWidth, superSampled.sceneHeight],
    [5760, 3240],
  );
  assert.deepEqual([superSampled.uiWidth, superSampled.uiHeight], [3840, 2160]);
});

test("4K automatic texture caps preserve real source detail without forcing it on low-memory devices", () => {
  const cap = {
    viewportWidth: 1920,
    viewportHeight: 1080,
    devicePixelRatio: 2,
    maxTextureSize: 8192,
  };
  assert.equal(recommendGraphics(cap).textureLimit, 4096);
  assert.equal(
    recommendGraphics({ ...cap, deviceMemory: 4 }).textureLimit,
    1024,
  );
  assert.equal(
    resolveGraphics({ textures: "4k" }, undefined, cap).textureLimit,
    4096,
  );
});

test("automatic budgets bound huge displays while explicit overrides remain explicit", () => {
  const cap = {
    viewportWidth: 7680,
    viewportHeight: 4320,
    devicePixelRatio: 1,
  };
  assert.equal(automaticRenderScale(cap), 0.5);
  assert.equal(
    resolveGraphics({ resolution: "100" }, recommendGraphics(cap), cap)
      .pixelRatio,
    1,
  );
  const low = {
    ...cap,
    viewportWidth: 3840,
    viewportHeight: 2160,
    deviceMemory: 4,
  };
  assert.equal(automaticRenderScale(low), 0.5);
  assert(automaticRenderScale({ ...low, software: true }) <= 1 / 3);
});

test("GPU limits and unsupported HDR fallback cannot allocate unsafe buffers", () => {
  const plan = planDisplayBuffers({
    width: 3840,
    height: 2160,
    devicePixelRatio: 2,
    scenePixelRatio: 4,
    maxEdge: 4096,
  });
  assert.equal(plan.sceneWidth, 4096);
  assert.equal(plan.uiWidth, 3840);
  const fallback = planDisplayBuffers({
    width: 1920,
    height: 1080,
    devicePixelRatio: 2,
    scenePixelRatio: 1.5,
    splitSupported: false,
  });
  assert.equal(fallback.split, false);
  assert.deepEqual([fallback.uiWidth, fallback.uiHeight], [2880, 1620]);
  const zero = planDisplayBuffers({ width: 0, height: 0 });
  assert(zero.sceneWidth >= 1 && zero.sceneHeight >= 1);
});
