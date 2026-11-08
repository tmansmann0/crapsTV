import test from "node:test";
import assert from "node:assert/strict";
import {
  createTVLayout,
  TV_TYPE,
  normalizeLabelMotion,
  TV_LABEL_MOTIONS,
} from "../src/tv-layout.js";

test("label motion defaults to smooth and accepts only the three local presentation modes", () => {
  assert.equal(createTVLayout(1920, 1080).labelMotion, "smooth");
  for (const mode of TV_LABEL_MOTIONS) {
    assert.equal(normalizeLabelMotion(mode), mode);
    assert.equal(
      createTVLayout(1920, 1080, { labelMotion: mode }).labelMotion,
      mode,
    );
  }
  for (const value of [null, undefined, "animated", true, {}, 0])
    assert.equal(normalizeLabelMotion(value), "smooth");
});

test("TV panels and typography double from 1080p to 4K in both size modes", () => {
  for (const uiSize of ["compact", "large"]) {
    const hd = createTVLayout(1920, 1080, { uiSize });
    const uhd = createTVLayout(3840, 2160, { uiSize });
    assert.deepEqual(hd.safeArea, { x: 80, y: 60 });
    for (const id of Object.keys(hd.panels)) {
      for (const key of ["x", "y", "width", "height"])
        assert(
          Math.abs(uhd.panels[id][key] - hd.panels[id][key] * 2) < 1e-7,
          `${uiSize} ${id} ${key}`,
        );
      for (const key of ["backingWidth", "backingHeight"])
        assert(
          Math.abs(uhd.panels[id][key] - hd.panels[id][key] * 2) <= 1,
          `${uiSize} raster rounding ${id} ${key}`,
        );
      assert(hd.panels[id].backingWidth >= hd.panels[id].width);
    }
    const retina = createTVLayout(1920, 1080, { uiSize, pixelRatio: 2 });
    assert.equal(retina.panels.join.backingWidth, uhd.panels.join.backingWidth);
  }
  assert(TV_TYPE.status >= 36);
  assert(TV_TYPE.result >= 50);
  assert(TV_TYPE.code >= 70);
});

test("Compact is the explicit smaller default, retaining TV safe areas and matching label scale", () => {
  const compact = createTVLayout(1920, 1080),
    large = createTVLayout(1920, 1080, { uiSize: "large" });
  assert.equal(compact.uiSize, "compact");
  assert.equal(compact.uiScale, 0.67);
  assert.equal(compact.labelScale, 0.67);
  assert.equal(large.uiScale, 1);
  assert.equal(large.labelScale, 1);
  assert.deepEqual(compact.safeArea, large.safeArea);
  for (const id of Object.keys(compact.panels)) {
    assert(
      Math.abs(compact.panels[id].width - large.panels[id].width * 0.67) < 1e-7,
    );
    assert(
      Math.abs(compact.panels[id].height - large.panels[id].height * 0.67) <
        1e-7,
    );
  }
  assert.equal(
    createTVLayout(1920, 1080, { uiSize: "invented" }).uiSize,
    "compact",
  );
});

test("corners, status and open settings fit supported landscape and compact frames", () => {
  for (const [w, h] of [
    [1920, 1080],
    [3840, 2160],
    [1280, 720],
    [2560, 1080],
    [1024, 768],
    [390, 844],
    [375, 640],
  ]) {
    for (const uiSize of ["compact", "large"]) {
      const layout = createTVLayout(w, h, { uiSize });
      for (const [id, p] of Object.entries(layout.panels)) {
        assert(p.x >= 0 && p.y >= 0, `${w} ${id} origin`);
        assert(p.x + p.width <= w + 0.01, `${w} ${id} width`);
        assert(p.y + p.height <= h + 0.01, `${w} ${id} height`);
      }
      const { join, brand, settingsButton, status } = layout.panels;
      assert(brand.x >= settingsButton.x + settingsButton.width);
      if (!layout.compact) assert(join.x >= brand.x + brand.width);
      assert(status.y > join.y + join.height);
    }
  }
});

test("canvas backing resolution respects hardware limits and invalid values are bounded", () => {
  const layout = createTVLayout(3840, 2160, {
    pixelRatio: 3,
    maxTextureSize: 2048,
  });
  for (const p of Object.values(layout.panels)) {
    assert(p.backingWidth <= 2048 && p.backingHeight <= 2048);
    assert(p.backingScale > 0);
  }
  assert.equal(createTVLayout(NaN, NaN).width, 1920);
});
