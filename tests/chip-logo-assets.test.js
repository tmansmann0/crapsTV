import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { PNG } from "pngjs";
const file = (name) => new URL("../public/assets/" + name, import.meta.url);
const digest = (data) => createHash("sha256").update(data).digest("hex");
async function model(name) {
  const bytes = await readFile(file(name)),
    length = bytes.readUInt32LE(12),
    g = JSON.parse(bytes.toString("utf8", 20, 20 + length)),
    base = 28 + length;
  function values(index) {
    const a = g.accessors[index],
      view = g.bufferViews[a.bufferView],
      k = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[a.type],
      size = { 5123: 2, 5125: 4, 5126: 4 }[a.componentType],
      read = {
        5123: "readUInt16LE",
        5125: "readUInt32LE",
        5126: "readFloatLE",
      }[a.componentType];
    return Array.from({ length: a.count }, (_, i) =>
      Array.from({ length: k }, (_, j) =>
        bytes[read](
          base +
            (view.byteOffset || 0) +
            (a.byteOffset || 0) +
            i * (view.byteStride || k * size) +
            j * size,
        ),
      ),
    );
  }
  return { g, values, bytes };
}
test("logo chip variants retain shared materials, dimensions and geometry budgets", async () => {
  const stats = JSON.parse(await readFile(file("chip-logo-stats.json")));
  for (const [name, budget] of [
    ["chip-logo.glb", 10100],
    ["chip-logo-lod.glb", 2500],
  ]) {
    const { g, values, bytes } = await model(name),
      primitives = g.meshes.flatMap((m) => m.primitives);
    const tris = primitives.reduce(
      (sum, p) => sum + g.accessors[p.indices].count / 3,
      0,
    );
    assert(tris <= budget);
    assert.equal(g.meshes.length, 1);
    assert.equal(primitives.length, 4);
    assert.deepEqual(g.materials.map((m) => m.name).sort(), [
      "ChipBase",
      "ChipEngraving",
      "ChipInlay",
      "ChipMetal",
    ]);
    const positions = primitives.flatMap((p) => values(p.attributes.POSITION));
    for (let axis = 0; axis < 3; axis++) {
      const min = Math.min(...positions.map((p) => p[axis])),
        max = Math.max(...positions.map((p) => p[axis]));
      assert(Math.abs(max - min - (axis === 1 ? 0.13 : 1)) < 1e-5);
    }
    const engraving = g.materials.find((m) => m.name === "ChipEngraving");
    assert(engraving.normalTexture);
    assert(engraving.pbrMetallicRoughness.baseColorTexture);
    assert.equal(engraving.pbrMetallicRoughness.roughnessFactor ?? 1, 1);
    assert(bytes.length < 300000, "shared images are not embedded twice");
    for (const image of g.images) {
      assert(!("bufferView" in image));
      const [name, query] = image.uri.split("?v=");
      assert.equal(query, digest(await readFile(file(name))).slice(0, 12));
    }
    assert.equal(
      tris,
      name === "chip-logo.glb" ? stats.high.triangles : stats.low.triangles,
    );
  }
});
test("front and back logos have matching readable orientation after an X flip", async () => {
  for (const name of ["chip-logo.glb", "chip-logo-lod.glb"]) {
    const { g, values } = await model(name),
      p = g.meshes
        .flatMap((m) => m.primitives)
        .find((p) => g.materials[p.material].name === "ChipEngraving"),
      pos = values(p.attributes.POSITION),
      uv = values(p.attributes.TEXCOORD_0),
      norm = values(p.attributes.NORMAL);
    let front = 0,
      back = 0;
    for (let i = 0; i < pos.length; i++) {
      const [x, y, z] = pos[i];
      if (Math.abs(Math.abs(y) - 0.046) > 1e-5 || Math.abs(norm[i][1]) < 0.99)
        continue;
      const top = y > 0;
      assert(Math.abs(uv[i][0] - ((top ? 0.25 : 0.75) + x * 0.45)) < 1e-5);
      assert(Math.abs(uv[i][1] - (0.63 + (top ? z : -z) * 0.45)) < 1e-5);
      if (top) front++;
      else back++;
    }
    assert(front >= 32 && back >= 32, name + " both stamped faces");
  }
});
test("monochrome mark is derived from the exact source logo pixels, without substituted lettering", async () => {
  const meta = JSON.parse(await readFile(file("chip-logo-atlas.json"))),
    sourceBytes = await readFile(file("brand-logo.png")),
    source = PNG.sync.read(sourceBytes),
    mark = PNG.sync.read(await readFile(file("chip-logo-mark.png")));
  assert.equal(meta.sourceSha256, digest(sourceBytes));
  assert.equal(meta.generatedArtwork, false);
  const [left, top, right, bottom] = meta.sourceCrop;
  assert.equal(mark.width, right - left);
  assert.equal(mark.height, bottom - top);
  let compared = 0,
    cut = 0,
    uncut = 0;
  for (let y = 0; y < mark.height; y += 7)
    for (let x = 0; x < mark.width; x += 7) {
      const s = ((top + y) * source.width + left + x) * 4,
        d = (y * mark.width + x) * 4,
        luma =
          (source.data[s] * 0.2126 +
            source.data[s + 1] * 0.7152 +
            source.data[s + 2] * 0.0722) /
          255,
        t = Math.min(1, Math.max(0, (luma - 0.24) / 0.2)),
        expected = source.data[s + 3] * t * t * (3 - 2 * t);
      assert(Math.abs(mark.data[d + 3] - expected) < 2);
      compared++;
      if (expected > 200) cut++;
      if (expected < 20) uncut++;
    }
  assert(compared > 10000 && cut > 1000 && uncut > 1000);
});
test("engraving is recessed height with real normal bevels and roughness, preserving original assets", async () => {
  const meta = JSON.parse(await readFile(file("chip-logo-atlas.json")));
  assert.equal(meta.cutDepth, 0.0032);
  const [color, height, normal, rough] = await Promise.all(
    ["albedo", "height", "normal", "roughness"].map(async (k) =>
      PNG.sync.read(await readFile(file("chip-logo-" + k + ".png"))),
    ),
  );
  let inside = 0,
    outside = 0,
    insideHeight = 0,
    outsideHeight = 0,
    beveled = 0;
  for (let i = 0; i < color.data.length; i += 4) {
    if (color.data[i] < 140) {
      inside++;
      insideHeight += height.data[i];
    } else if (color.data[i] > 185) {
      outside++;
      outsideHeight += height.data[i];
    }
    if (
      Math.abs(normal.data[i] - 127) > 25 ||
      Math.abs(normal.data[i + 1] - 127) > 25
    )
      beveled++;
    assert(rough.data[i] >= 140 && rough.data[i] <= 195);
  }
  assert(inside > 1000 && outside > 10000);
  assert(
    insideHeight / inside < outsideHeight / outside - 60,
    "logo floors are lower than clay",
  );
  assert(beveled > 1000, "bevel slopes exist in normal map");
  const stats = JSON.parse(await readFile(file("chip-logo-stats.json")));
  for (const [name, hash] of Object.entries(stats.preservedSha256))
    assert.equal(
      digest(await readFile(new URL("../" + name, import.meta.url))),
      hash,
      name,
    );
});
