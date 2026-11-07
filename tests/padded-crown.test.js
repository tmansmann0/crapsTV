import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
const root = new URL("../", import.meta.url);
async function glb(path) {
  const bytes = await readFile(new URL(path, root));
  const n = bytes.readUInt32LE(12),
    json = JSON.parse(bytes.toString("utf8", 20, 20 + n)),
    start = 28 + n;
  function values(index) {
    const a = json.accessors[index],
      v = json.bufferViews[a.bufferView];
    const width = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[a.type];
    const [size, read] = {
      5123: [2, "readUInt16LE"],
      5125: [4, "readUInt32LE"],
      5126: [4, "readFloatLE"],
    }[a.componentType];
    return Array.from({ length: a.count }, (_, i) =>
      Array.from({ length: width }, (_, j) =>
        bytes[read](
          start +
            (v.byteOffset || 0) +
            (a.byteOffset || 0) +
            i * (v.byteStride || width * size) +
            j * size,
        ),
      ),
    );
  }
  const primitives = new Map();
  for (const m of json.meshes)
    for (const p of m.primitives)
      primitives.set(json.materials[p.material].name, {
        indices: values(p.indices).flat(),
        ...Object.fromEntries(
          Object.entries(p.attributes).map(([key, value]) => [
            key,
            values(value),
          ]),
        ),
      });
  return { json, primitives };
}
const current = () => glb("public/assets/table-player-rails-optimized.glb");
const legacy = () =>
  glb("assets/source/legacy/0.11.0/table-player-rails-optimized.glb");

test("rounded crown preserves exact non-leather exported geometry, physical UVs and shading normals", async () => {
  const [a, b] = await Promise.all([current(), legacy()]);
  assert.equal(a.primitives.size, 7);
  for (const [name, p] of b.primitives) {
    if (name === "Deep oxblood leather") continue;
    assert.deepEqual(
      a.primitives.get(name),
      p,
      name + " exported payload unchanged",
    );
  }
});

test("padded crown has curvature-sampled profile and continuous analytic normals without an all-table subdivision", async () => {
  const { primitives } = await current(),
    p = primitives.get("Deep oxblood leather");
  const stats = JSON.parse(
    await readFile(
      new URL("public/assets/table-player-rails-optimized-stats.json", root),
    ),
  );
  const c = stats.paddedCrown;
  assert.equal(stats.after.triangles, 40684);
  assert(stats.after.triangles <= 42000);
  assert.equal(c.triangles, p.indices.length / 3);
  assert.equal(c.triangles, 6008);
  assert.equal(c.profileRows, 21);
  assert.equal(c.boundaryEdges, 0);
  assert.equal(c.nonManifoldEdges, 0);
  assert.equal(c.analyticCornerNormals, true);
  assert.equal(c.maxProfileTurnDegrees, 14);
  assert.deepEqual(c.bounds, [
    [-6.050000190734863, 6.050000190734863],
    [-3.3399999141693115, 3.3399999141693115],
    [0.6399999856948853, 0.9200000166893005],
  ]);
  const rows = new Map();
  for (let i = 0; i < p.POSITION.length; i++) {
    const [x, y, z] = p.POSITION[i],
      n = p.NORMAL[i];
    assert(Math.abs(Math.hypot(...n) - 1) < 1e-5);
    // Straight front span, away from the four cup cuts and hidden bottom seam.
    if (
      Math.abs(x - 4.56) > 0.00001 ||
      z < 2.74 ||
      y < 0.74001 ||
      y > 0.92001 ||
      Math.abs(n[0]) > 0.0001 ||
      n[1] < -0.001
    )
      continue;
    const key = y.toFixed(6) + ":" + z.toFixed(6);
    rows.set(key, { offset: z - 2.74, height: y, n });
  }
  assert(rows.size >= 17, "fine profile rows survive glTF export");
  const sorted = [...rows.values()].sort((a, b) => b.offset - a.offset);
  for (let i = 1; i < sorted.length; i++) {
    const a = sorted[i - 1].n,
      b = sorted[i].n;
    const angle =
      (Math.acos(
        Math.min(
          1,
          Math.max(
            -1,
            a.reduce((s, v, j) => s + v * b[j], 0),
          ),
        ),
      ) *
        180) /
      Math.PI;
    assert(
      angle < 14.3,
      "no broad flat lighting band across profile: " + angle,
    );
  }
  // Same physical 0.8-unit UV1 scale runs along the straight rail.
  let checked = 0;
  for (let i = 0; i < p.indices.length; i += 3)
    for (const [j, k] of [
      [0, 1],
      [1, 2],
      [2, 0],
    ]) {
      const a = p.indices[i + j],
        b = p.indices[i + k],
        v = p.POSITION[a],
        w = p.POSITION[b];
      if (
        v[2] < 2.74 ||
        Math.abs(v[1] - w[1]) > 1e-6 ||
        Math.abs(v[2] - w[2]) > 1e-6 ||
        Math.abs(v[0] - w[0]) < 0.5
      )
        continue;
      const uv = p.TEXCOORD_1;
      assert(
        Math.abs(Math.abs((uv[a][0] - uv[b][0]) / (v[0] - w[0])) - 1.25) < 1e-4,
      );
      checked++;
    }
  assert(checked > 10, "inspected straight-span detail UV scale");
  let across = 0;
  for (let i = 0; i < p.indices.length; i += 3)
    for (const [j, k] of [
      [0, 1],
      [1, 2],
      [2, 0],
    ]) {
      const a = p.indices[i + j],
        b = p.indices[i + k],
        v = p.POSITION[a],
        w = p.POSITION[b];
      if (
        Math.abs(v[0] - 4.56) > 1e-5 ||
        Math.abs(v[0] - w[0]) > 1e-6 ||
        v[2] < 2.74 ||
        w[2] < 2.74 ||
        Math.abs(v[2] - w[2]) < 1e-5 ||
        Math.abs(v[1] - w[1]) < 1e-5
      )
        continue;
      const distance = Math.hypot(v[1] - w[1], v[2] - w[2]),
        uv = p.TEXCOORD_1;
      assert(
        Math.abs(Math.abs(uv[a][1] - uv[b][1]) / distance - 1.25) < 0.002,
        "arc-length UV scale across rounded narrow bands",
      );
      across++;
    }
  assert(across > 20, "inspected physical profile UV density");
});

test("versioned 0.11.0 GLB, Blender source and stats remain available byte for byte for rollback", async () => {
  const manifest = JSON.parse(
    await readFile(new URL("assets/source/legacy/0.11.0/manifest.json", root)),
  );
  for (const [path, hash] of Object.entries(manifest.sha256))
    assert.equal(
      createHash("sha256")
        .update(
          await readFile(new URL("assets/source/legacy/0.11.0/" + path, root)),
        )
        .digest("hex"),
      hash,
      path,
    );
});
