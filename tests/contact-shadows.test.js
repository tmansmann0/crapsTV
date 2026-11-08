import test from "node:test";
import assert from "node:assert/strict";
import { DirectionalLight } from "three";
import { createContactShadows } from "../src/contact-shadows.js";

test("optional contact shadows retain and restore the original map and bias without changing the light", () => {
  const light = new DirectionalLight();
  light.shadow.mapSize.set(2048, 2048);
  light.shadow.bias = -0.0002;
  light.shadow.normalBias = 0.02;
  const originalMap = {
    dispose() {
      assert.fail("original map is retained");
    },
  };
  light.shadow.map = originalMap;
  const fx = createContactShadows(light);
  assert.equal(fx.enabled, false);
  assert.equal(light.shadow.map, originalMap);
  assert(fx.setEnabled(true));
  assert.equal(fx.size, 4096);
  assert.equal(light.shadow.map, null);
  assert.equal(light.shadow.normalBias, 0.006);
  let released = 0;
  light.shadow.map = {
    dispose() {
      released++;
    },
  };
  assert.equal(fx.setEnabled(true), false);
  assert.equal(released, 0);
  assert(fx.setEnabled(false));
  assert.equal(released, 1);
  assert.equal(light.shadow.map, originalMap);
  assert.equal(fx.size, 2048);
  assert.equal(light.shadow.bias, -0.0002);
  assert.equal(light.shadow.normalBias, 0.02);
  fx.dispose();
  assert.equal(fx.setEnabled(true), false);
});

test("contact shadow resolution respects the device limit", () => {
  const light = new DirectionalLight();
  const fx = createContactShadows(light, { maxTextureSize: 2048 });
  fx.setEnabled(true);
  assert.equal(fx.size, 2048);
  fx.dispose();
});
