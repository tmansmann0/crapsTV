import test from "node:test";
import assert from "node:assert/strict";
import {
  tvGeometry,
  textAngleArcminutes,
  requiredTextPixels,
} from "../scripts/tv-readability.mjs";
test("65inch16:9 dimensions and viewing-angle roundtrip", () => {
  assert(Math.abs(tvGeometry().heightInches - 31.86698) < 1e-5);
  const px = requiredTextPixels(24, 1080, 14);
  assert(Math.abs(px - 39.74946) < 1e-5);
  assert(Math.abs(textAngleArcminutes(px, 1080, 14) - 24) < 1e-10);
});
test("4K doubles pixels to keep physical text size; resolution alone cannot fix tiny UI", () => {
  assert.equal(
    textAngleArcminutes(26, 1080, 14),
    textAngleArcminutes(52, 2160, 14),
  );
  assert(textAngleArcminutes(26, 2160, 14) < 8);
});
test("greater distance lowers angular size without changing pixel count", () => {
  assert(textAngleArcminutes(26, 1080, 8) > 27);
  assert(textAngleArcminutes(26, 1080, 14) < 16);
});
test("invalid geometric inputs are rejected", () => {
  assert.throws(() => tvGeometry(0));
  assert.throws(() => textAngleArcminutes(20, 0, 10));
  assert.throws(() => requiredTextPixels(NaN, 1080, 10));
});
