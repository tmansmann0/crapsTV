import test from "node:test";
import assert from "node:assert/strict";
import {
  benchmarkConfig,
  assertBenchmarkResolution,
} from "../scripts/benchmark-config.mjs";
test("native1080p is explicit even when CI is set", () => {
  const c = benchmarkConfig({ CI: "true" });
  assert.deepEqual(c.expected, { width: 1920, height: 1080 });
  assert.equal(c.graphics.resolution, "100");
  assert.equal(c.graphics.textures, "native");
  assert.equal(c.graphics.modelDetail, "full");
});
test("4K framebuffer can be requested as4KCSS or1080pCSS at2xDPR", () => {
  assert.deepEqual(
    benchmarkConfig({ BENCH_WIDTH: "3840", BENCH_HEIGHT: "2160" }).expected,
    { width: 3840, height: 2160 },
  );
  assert.deepEqual(benchmarkConfig({ BENCH_DPR: "2" }).expected, {
    width: 3840,
    height: 2160,
  });
});
test("a75percent raster is reported as2880x1620 rather than4K", () => {
  const c = benchmarkConfig({
    BENCH_WIDTH: "3840",
    BENCH_HEIGHT: "2160",
    BENCH_RESOLUTION: "75",
  });
  assert.deepEqual(c.expected, { width: 2880, height: 1620 });
  assert.throws(
    () => assertBenchmarkResolution(c, { width: 3840, height: 2160 }),
    /mismatch/,
  );
});
test("silently reduced output fails a native4K assertion", () => {
  const c = benchmarkConfig({ BENCH_WIDTH: "3840", BENCH_HEIGHT: "2160" });
  assert.throws(
    () => assertBenchmarkResolution(c, { width: 1600, height: 900 }),
    /not a native-resolution result/,
  );
  assert.equal(
    assertBenchmarkResolution(c, { width: 3840, height: 2160 }),
    true,
  );
});
test("Auto can be measured but never labelled resolution verified", () => {
  assert.equal(
    assertBenchmarkResolution(benchmarkConfig({ BENCH_RESOLUTION: "auto" }), {
      width: 900,
      height: 600,
    }),
    false,
  );
});
test("invalid dimensions and graphics options are rejected", () => {
  assert.throws(() => benchmarkConfig({ BENCH_DPR: "NaN" }));
  assert.throws(() => benchmarkConfig({ BENCH_WIDTH: "0" }));
  assert.throws(() => benchmarkConfig({ BENCH_MODEL: "fake" }));
});

test("4K texture budget remains explicit in a native-framebuffer benchmark", () => {
  const c = benchmarkConfig({ BENCH_TEXTURES: "4k" });
  assert.equal(c.graphics.textures, "4k");
  assert.deepEqual(c.expected, { width: 1920, height: 1080 });
});

test("benchmarks use the Compact default unless Large is explicitly requested", () => {
  assert.equal(benchmarkConfig({}).uiSize, "compact");
  assert.equal(benchmarkConfig({ BENCH_UI_SIZE: "large" }).uiSize, "large");
  assert.throws(() => benchmarkConfig({ BENCH_UI_SIZE: "huge" }));
});
