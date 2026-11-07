import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { PNG } from "pngjs";
const file = (name) => new URL("../public/assets/" + name, import.meta.url);
const digest = (data) => createHash("sha256").update(data).digest("hex");
async function model(name, archive = false) {
  const bytes = await readFile(
      archive
        ? new URL(
            "../assets/source/legacy/chip-logo-d256e2d/" + name,
            import.meta.url,
          )
        : file(name),
    ),
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
    assert(
      bytes.length < 320000,
      "shared maps stay external; only medallion gains UV1",
    );
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
    const detail = values(p.attributes.TEXCOORD_1);
    let front = 0,
      back = 0;
    for (let i = 0; i < pos.length; i++) {
      const [x, y, z] = pos[i];
      if (Math.abs(Math.abs(y) - 0.046) > 1e-5 || Math.abs(norm[i][1]) < 0.99)
        continue;
      const top = y > 0;
      assert(Math.abs(uv[i][0] - ((top ? 0.25 : 0.75) + x * 0.45)) < 1e-5);
      assert(Math.abs(uv[i][1] - (0.63 + (top ? z : -z) * 0.45)) < 1e-5);
      assert(Math.abs(detail[i][0] - (0.5 + x / 0.626)) < 1e-5);
      assert(Math.abs(detail[i][1] - (0.5 + (top ? z : -z) / 0.626)) < 1e-5);
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
  }
  for (let i = 0; i < rough.data.length; i += 4)
    assert(rough.data[i] >= 140 && rough.data[i] <= 195);
  assert.deepEqual([color.width, color.height], meta.mapSizes.albedo);
  assert.deepEqual([normal.width, normal.height], meta.mapSizes.normal);
  assert.deepEqual([rough.width, rough.height], meta.mapSizes.roughness);
  assert.equal(color.width, 2048, "macro albedo retains true source detail");
  assert.equal(normal.width, 2048, "macro bevel normal has the same detail");
  assert.equal(rough.width, 1024, "roughness remains a bounded 1K map");
  assert(
    Math.abs(
      (meta.bevelBlurPixels / meta.atlasSize[0]) * meta.tileSceneWidth -
        1.2 / 1024 / 0.45,
    ) < 1e-12,
    "physical bevel width stays unchanged",
  );
  assert.equal(meta.albedoBlurPixels, 0);
  assert(meta.effectiveLogoPixels > 1800 && meta.linearDetailGain > 3.5);
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

test("dedicated medallion UV preserves all original geometry, normals and wear UV0 on both LODs", async () => {
  for (const name of ["chip-logo.glb", "chip-logo-lod.glb"]) {
    const before = await model(name, true),
      after = await model(name);
    const triangles = (data, material) => {
      const p = data.g.meshes
        .flatMap((m) => m.primitives)
        .find((p) => data.g.materials[p.material].name === material);
      const attrs = ["POSITION", "NORMAL", "TEXCOORD_0"].map((k) =>
        data.values(p.attributes[k]),
      );
      const ids = data.values(p.indices).flat(),
        out = [];
      for (let i = 0; i < ids.length; i += 3) {
        const rows = ids.slice(i, i + 3).map((id) =>
          attrs
            .flatMap((a) => a[id])
            .map((n) => n.toFixed(6))
            .join(","),
        );
        const rotated = [
          rows.join("|"),
          [rows[1], rows[2], rows[0]].join("|"),
          [rows[2], rows[0], rows[1]].join("|"),
        ];
        out.push(rotated.sort()[0]);
      }
      return out.sort();
    };
    for (const mat of ["ChipBase", "ChipInlay", "ChipEngraving", "ChipMetal"])
      assert.deepEqual(
        triangles(after, mat),
        triangles(before, mat),
        `${name}/${mat} keeps original triangle winding, shape, normals and scuff coordinates`,
      );
    const material = after.g.materials.find((m) => m.name === "ChipEngraving");
    assert.equal(material.normalTexture.texCoord, 1);
    assert.equal(material.pbrMetallicRoughness.baseColorTexture.texCoord, 1);
    for (const p of after.g.meshes.flatMap((m) => m.primitives))
      assert.equal(
        "TEXCOORD_1" in p.attributes,
        after.g.materials[p.material].name === "ChipEngraving",
      );
  }
});

test("clay guide paint and machining ripples no longer introduce radial grime bands", async () => {
  const image = PNG.sync.read(await readFile(file("chip-color.png")));
  const means = [];
  for (const r of [0.73, 0.75, 0.77, 0.8, 0.82, 0.84]) {
    let total = 0,
      count = 0;
    for (let y = 0; y < image.height; y++)
      for (let x = 0; x < image.width; x++) {
        const radius =
          Math.hypot(
            (x + 0.5) / image.width - 0.25,
            (y + 0.5) / image.height - 0.63,
          ) / 0.225;
        if (Math.abs(radius - r) < 0.004) {
          total += image.data[(y * image.width + x) * 4];
          count++;
        }
      }
    means.push(total / count);
  }
  assert(
    Math.abs(means[1] - (means[0] + means[2]) / 2) < 2,
    "no painted .75-radius dark circle",
  );
  assert(
    Math.abs(means[4] - (means[3] + means[5]) / 2) < 2,
    "no painted .82-radius dark circle",
  );
  const metadata = JSON.parse(await readFile(file("chip-clay-detail.json")));
  assert(metadata.removed.some((v) => v.includes("sin(radius*340)")));
});
