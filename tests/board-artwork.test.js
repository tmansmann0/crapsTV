import test from "node:test";
import assert from "node:assert/strict";
import { boardPrintWidth } from "../src/board-artwork.js";
test("critical SVG print budget is independent of modeled texture settings", () => {
  assert.equal(
    boardPrintWidth({ maxTextureSize: 16384, deviceMemory: 8 }),
    8192,
  );
  assert.equal(
    boardPrintWidth({ maxTextureSize: 16384, deviceMemory: 4 }),
    4096,
  );
  assert.equal(boardPrintWidth({ maxTextureSize: 8192, software: true }), 4096);
  assert.equal(boardPrintWidth({ maxTextureSize: 2048 }), 2048);
  assert.equal(boardPrintWidth({ maxTextureSize: 6000 }), 4096);
});
