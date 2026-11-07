import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripBoardHatch } from "../src/board-hatch.js";

for (const mode of ["classic", "crapless"])
  test(`${mode} removes only decorative repeated hatch and preserves semantic regions and glyph definitions`, async () => {
    const source = await readFile(
      new URL(`../public/assets/board-${mode}.svg`, import.meta.url),
      "utf8",
    );
    const result = stripBoardHatch(source);
    assert(result.removed >= 10 && result.removed <= 16);
    assert.equal(stripBoardHatch(result.svg).removed, 0);
    for (const pattern of [
      /data-bet-id="[^"]+"/g,
      /id="glyph-[^"]+"/g,
      /<image\b[^>]*\/>/g,
    ])
      assert.deepEqual(result.svg.match(pattern), source.match(pattern));
    assert.equal(
      (source.match(/<path\b/g) || []).length -
        (result.svg.match(/<path\b/g) || []).length,
      result.removed,
    );
  });
