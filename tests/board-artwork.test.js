import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import * as THREE from "three";
import { readBoardVector } from "../src/board-vector.js";
import { createBoardArtwork } from "../src/board-artwork.js";
import { boardPrintWidth } from "../src/board-raster-artwork.js";
const renderer = { capabilities: { getMaxAnisotropy: () => 8 } };
async function geometry(mode) {
  const b = await readFile(
    new URL(`../public/assets/board-${mode}-vector.bin`, import.meta.url),
  );
  return readBoardVector(
    b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength),
  );
}
for (const mode of ["classic", "crapless"])
  test(`${mode} actual SVG contours preserve source paints, masks and bounded geometry`, async () => {
    const binary = await readFile(
      new URL(`../public/assets/board-${mode}-vector.bin`, import.meta.url),
    );
    const metadata = JSON.parse(
      await readFile(
        new URL(`../public/assets/board-${mode}-vector.json`, import.meta.url),
      ),
    );
    const source = await readFile(
      new URL(`../public/assets/board-${mode}.svg`, import.meta.url),
    );
    assert.equal(
      createHash("sha256").update(binary).digest("hex"),
      metadata.binarySHA256,
    );
    assert.equal(
      createHash("sha256").update(source).digest("hex"),
      metadata.sourceSHA256,
    );
    const g = await geometry(mode),
      paint = g.getAttribute("paint");
    assert(g.index.count / 3 < 60000 && g.index.count / 3 > 40000);
    assert.equal(g.index.count / 3, metadata.triangles);
    assert.equal(metadata.maskedGroups.length, mode === "classic" ? 30 : 35);
    assert.deepEqual(
      [...new Set(metadata.maskedGroups.map((m) => m.opacity))].sort(),
      [0.7, 0.75, 0.8],
    );
    assert(
      metadata.maskedGroups.some((m) => m.emptyObjectBox),
      "zero-bbox opacity masks retain source SVG semantics",
    );
    assert.equal(metadata.logoPaint, g.userData.vectorBoard.logoPaint);
    let previous = 0;
    for (let i = 0; i < g.index.count; i += 3) {
      const a = g.index.getX(i),
        p = paint.getX(a);
      assert(p >= previous);
      previous = p;
      for (let j = 0; j < 3; j++) {
        const index = g.index.getX(i + j);
        assert(index < g.attributes.position.count);
        assert.equal(paint.getX(index), p);
      }
    }
    assert(g.boundingBox.min.x >= -5.421 && g.boundingBox.max.x <= 5.421);
    assert(g.boundingBox.min.y >= -2.701 && g.boundingBox.max.y <= 2.701);
    g.dispose();
  });
test("both vector layouts and small minification maps load once; switching never creates a macro raster atlas", async () => {
  const owned = [],
    disposed = [];
  const controller = createBoardArtwork(renderer, {
    loadGeometry: async (name) => {
      const g = await geometry(
        name.includes("crapless") ? "crapless" : "classic",
      );
      owned.push(g);
      g.addEventListener("dispose", () => disposed.push(g));
      return g;
    },
    loadTexture: async () => {
      const t = new THREE.Texture({ width: 1920, height: 819 });
      owned.push(t);
      t.addEventListener("dispose", () => disposed.push(t));
      return t;
    },
  });
  controller.select("crapless");
  await controller.ready;
  assert.equal(controller.mode, "crapless");
  assert(controller.triangles > 40000);
  assert.equal(controller.logoTexture.image.width, 1920);
  controller.select("classic");
  assert.equal(controller.mode, "classic");
  assert.equal(owned.length, 5);
  assert.equal(controller.metrics.width, 1);
  controller.dispose();
  controller.dispose();
  assert.equal(disposed.length, 5);
  assert.equal(new Set(disposed).size, 5);
});
test("failed or cancelled critical vector load waits for and releases late successes", async () => {
  let release;
  const late = new Promise((r) => (release = r)),
    disposed = [];
  const controller = createBoardArtwork(renderer, {
    loadGeometry: async (name) => {
      if (name.includes("classic")) throw Error("vector missing");
      return late;
    },
    loadTexture: async () => {
      const t = new THREE.Texture();
      t.addEventListener("dispose", () => disposed.push("logo"));
      return t;
    },
  });
  const failed = controller.ready;
  failed.catch(() => {});
  await new Promise(setImmediate);
  assert.equal(disposed.length, 0);
  const g = await geometry("crapless");
  g.addEventListener("dispose", () => disposed.push("geometry"));
  release(g);
  await assert.rejects(failed, /vector missing/);
  assert.deepEqual(disposed.sort(), ["geometry", "logo", "logo", "logo"]);
  controller.dispose();
  const cancelled = createBoardArtwork(renderer, {
    loadGeometry: async (name) =>
      geometry(name.includes("crapless") ? "crapless" : "classic"),
    loadTexture: async () => new THREE.Texture(),
  });
  cancelled.dispose();
  await cancelled.ready;
  assert.equal(cancelled.mode, undefined);
});
test("the historical raster reference budget is explicit and never used by production vectors", () => {
  assert.equal(
    boardPrintWidth({ maxTextureSize: 16384, deviceMemory: 8 }),
    8192,
  );
  assert.equal(
    boardPrintWidth({ maxTextureSize: 16384, deviceMemory: 4 }),
    4096,
  );
  assert.equal(boardPrintWidth({ maxTextureSize: 8192, software: true }), 4096);
});
