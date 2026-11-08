import test from "node:test";
import assert from "node:assert/strict";
import {
  benchmarkConfig,
  assertBenchmarkResolution,
  benchmarkEffectsStatus,
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

test("optional effects are explicitly Off unless all three are requested On", () => {
  for (const effects of [undefined, "off", "on"]) {
    const c = benchmarkConfig({ BENCH_EFFECTS: effects });
    assert.equal(c.effects, effects || "off");
    for (const key of ["lensFlares", "localReflections", "contactShadows"])
      assert.equal(c.graphics[key], effects || "off");
    if (effects === "on") assert.match(c.label, /effects-on$/);
  }
  assert.throws(
    () => benchmarkConfig({ BENCH_EFFECTS: "auto" }),
    /BENCH_EFFECTS/,
  );
});

test("effects On requires actual enabled state and a supported completed probe, not just preferences", () => {
  const c = benchmarkConfig({ BENCH_EFFECTS: "on" });
  const effective = {
    lensFlares: "true",
    lensFlareSources: "0",
    lensFlareResources: "0",
    contactShadows: "true",
    contactShadowSize: "4096",
    localReflectionRevision: "2",
    localReflections: JSON.stringify({
      enabled: true,
      supported: true,
      state: "ready",
      commits: 2,
      revision: 2,
      estimatedBytes: 34777771,
    }),
  };
  const status = benchmarkEffectsStatus(c, effective);
  assert.equal(status.verified, true);
  assert.equal(
    status.actual.lensFlares.visibleSources,
    0,
    "offscreen lamps are truthful zero visible flares",
  );
  assert.equal(
    benchmarkEffectsStatus(c, { ...effective, contactShadows: "false" })
      .verified,
    false,
  );
  for (const patch of [
    { state: "waiting" },
    { commits: 0 },
    { supported: false },
    { enabled: false },
    { revision: 1 },
  ])
    assert.equal(
      benchmarkEffectsStatus(c, {
        ...effective,
        localReflections: JSON.stringify({
          ...JSON.parse(effective.localReflections),
          ...patch,
        }),
      }).verified,
      false,
    );
  assert.equal(
    benchmarkEffectsStatus(c, { graphics: JSON.stringify(c.graphics) })
      .verified,
    false,
  );
  const duringPlay = { ...effective, localReflectionRevision: "3" };
  assert.equal(benchmarkEffectsStatus(c, duringPlay).verified, false);
  const liveStatus = benchmarkEffectsStatus(c, duringPlay, {
    requireCurrent: false,
  });
  assert.equal(
    liveStatus.verified,
    true,
    "live throws retain a valid previous probe by design",
  );
  assert.equal(
    liveStatus.currentProbe,
    false,
    "the report still identifies the cached map as stale",
  );
});

test("effects Off verifies zero owned resources and rejects missing or malformed telemetry", () => {
  const c = benchmarkConfig();
  const effective = {
    lensFlares: "false",
    lensFlareSources: "0",
    lensFlareResources: "0",
    contactShadows: "false",
    contactShadowSize: "2048",
    localReflections: JSON.stringify({
      enabled: false,
      state: "off",
      estimatedBytes: 0,
    }),
  };
  assert.equal(benchmarkEffectsStatus(c, effective).verified, true);
  assert.equal(
    benchmarkEffectsStatus(c, { ...effective, lensFlareResources: "1" })
      .verified,
    false,
  );
  assert.equal(
    benchmarkEffectsStatus(c, { ...effective, localReflections: "broken" })
      .verified,
    false,
  );
  assert.equal(benchmarkEffectsStatus(c, {}).verified, false);
});
