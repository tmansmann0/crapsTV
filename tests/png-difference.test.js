import { test } from "node:test";
import assert from "node:assert/strict";
import { PNG } from "pngjs";
import { pngDifference } from "../scripts/png-difference.mjs";

test("PNG comparison decodes pixels and counts changed pixels once", () => {
  const a = new PNG({ width: 2, height: 1 });
  a.data.set([255, 0, 10, 255, 10, 20, 30, 255]);
  const first = PNG.sync.write(a, { deflateLevel: 1 });
  assert.deepEqual(
    pngDifference(first, PNG.sync.write(a, { deflateLevel: 9 })),
    {
      meanAbsoluteDifference: 0,
      maxChannelDifference: 0,
      changedPixels: 0,
    },
  );
  a.data[0] = 251;
  a.data[2] = 14;
  a.data[7] = 247;
  assert.deepEqual(pngDifference(first, PNG.sync.write(a)), {
    meanAbsoluteDifference: 2,
    maxChannelDifference: 8,
    changedPixels: 2,
  });
  const wrongSize = PNG.sync.write(new PNG({ width: 1, height: 1 }));
  assert.throws(() => pngDifference(first, wrongSize), /dimensions differ/);
});
