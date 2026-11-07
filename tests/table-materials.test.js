import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import * as THREE from "three";
import { createTableMaterials } from "../src/table-materials.js";
const names = [
  "Hand-polished dark walnut",
  "Deep oxblood leather",
  "Dark pine pyramid bounce rubber",
  "Aged champagne brass",
  "Dark recessed cup wells",
  "Deep pine baize",
  "Player tray suede",
];
const setup = () =>
  createTableMaterials(
    { capabilities: { getMaxAnisotropy: () => 4 } },
    {
      resolveAsset: (n) => n,
      loadTexture: async (name) => {
        const t = new THREE.Texture({ width: 32, height: 32 });
        t.name = name;
        return t;
      },
    },
  );

test("table overrides keep material identities and UVs with true map-encoded roughness", async () => {
  const c = await setup(),
    root = new THREE.Group();
  for (const name of names) {
    const m = new THREE.MeshPhysicalMaterial({
      roughness: 0.25,
      clearcoat: 0.32,
    });
    m.name = name;
    root.add(new THREE.Mesh(new THREE.BoxGeometry(), m));
  }
  const g = root.children[0].geometry,
    uv = g.attributes.uv.array.slice();
  c.apply(root);
  for (const object of root.children) {
    assert(names.includes(object.material.name));
    assert.equal(object.material.roughness, 1);
    assert(object.material.roughnessMap);
    assert.equal(object.material.roughnessMap.colorSpace, THREE.NoColorSpace);
    assert.equal(object.material.normalMap.channel, 1);
    assert.equal(object.material.normalMap.flipY, false);
    assert.equal(object.material.map.colorSpace, THREE.SRGBColorSpace);
  }
  assert.deepEqual(g.attributes.uv.array, uv);
  const wood = root.children[0].material;
  assert.equal(wood.clearcoat, 0.16);
  assert.equal(wood.clearcoatRoughness, 0.38);
  assert.equal(wood.map.repeat.x, 0.8 / 4);
  assert.equal(wood.normalMap.repeat.x, 0.8 / 4);
  assert.equal(wood.map.channel, 1);
  assert.equal(wood.normalScale.x, 0.55);
  assert.equal(wood.envMapIntensity, 0.8);
  assert.equal(wood.normalMap.channel, 1);
  assert.equal(
    root.children[2].material.normalMap.name,
    "table-rubber-normal.png",
  );
  const same = wood;
  c.apply(root);
  assert.equal(root.children[0].material, same);
  c.dispose();
  assert.throws(() => c.apply(root), /disposed/);
});

test("only known table materials change and all maps are registered/disposed once", async () => {
  const c = await setup();
  const other = new THREE.MeshStandardMaterial();
  other.name = "DiceBody";
  const root = new THREE.Group();
  root.add(new THREE.Mesh(new THREE.BoxGeometry(), other));
  c.apply(root);
  assert.equal(root.children[0].material, other);
  assert.equal(c.textures.size, 18);
  let count = 0;
  for (const t of c.textures) {
    t.addEventListener("dispose", () => count++);
    assert.equal(t.anisotropy, 4);
  }
  c.dispose();
  c.dispose();
  assert.equal(count, 18);
});

test("encoded roughness stays in the matte/satin palette and texture budgets remain bounded", async () => {
  const data = JSON.parse(
    await readFile(
      new URL("../public/assets/material-table-metadata.json", import.meta.url),
    ),
  );
  const wood = data.maps["material-table-walnut-roughness"];
  assert(wood.min >= 0.4 && wood.max <= 0.6);
  const leather = data.maps["material-table-leather-roughness"];
  assert(leather.min >= 0.6 && leather.max <= 0.8);
  assert.equal(data.roughnessScalar, 1);
  for (const map of Object.values(data.maps)) {
    assert(map.width <= 2048);
    assert(map.height <= 2048);
  }
});

test("standard glTF wood upgrades to physical satin while other materials retain their type", async () => {
  const c = await setup();
  const root = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide });
  wood.name = names[0];
  const leather = new THREE.MeshStandardMaterial();
  leather.name = names[1];
  root.add(
    new THREE.Mesh(new THREE.BoxGeometry(), wood),
    new THREE.Mesh(new THREE.BoxGeometry(), leather),
  );
  c.apply(root);
  assert.equal(root.children[0].material.isMeshPhysicalMaterial, true);
  assert.equal(root.children[0].material.clearcoat, 0.16);
  assert.equal(root.children[0].material.side, THREE.DoubleSide);
  assert.equal(root.children[1].material.isMeshPhysicalMaterial, undefined);
  c.dispose();
});

async function exportedWood() {
  const bytes = await readFile(
    new URL(
      "../public/assets/table-player-rails-optimized.glb",
      import.meta.url,
    ),
  );
  const jsonLength = bytes.readUInt32LE(12),
    gltf = JSON.parse(bytes.toString("utf8", 20, 20 + jsonLength));
  const binStart = 20 + jsonLength + 8;
  function values(index) {
    const a = gltf.accessors[index],
      v = gltf.bufferViews[a.bufferView],
      width = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[a.type];
    const size = { 5123: 2, 5125: 4, 5126: 4 }[a.componentType];
    const read = {
      5123: "readUInt16LE",
      5125: "readUInt32LE",
      5126: "readFloatLE",
    }[a.componentType];
    return Array.from({ length: a.count }, (_, i) =>
      Array.from({ length: width }, (_, j) =>
        bytes[read](
          binStart +
            (v.byteOffset || 0) +
            (a.byteOffset || 0) +
            i * (v.byteStride || width * size) +
            j * size,
        ),
      ),
    );
  }
  const p = gltf.meshes
    .flatMap((m) => m.primitives)
    .find(
      (p) => gltf.materials[p.material].name === "Hand-polished dark walnut",
    );
  const pos = values(p.attributes.POSITION),
    uv = values(p.attributes.TEXCOORD_1),
    indices = values(p.indices).flat();
  return { pos, uv, indices };
}

test("exported wood grain follows straight shelf boards and upright legs", async () => {
  const { pos, uv, indices } = await exportedWood();
  const counts = { front: 0, side: 0, leg: 0 };
  for (let i = 0; i < indices.length; i += 3) {
    for (const [j, k] of [
      [0, 1],
      [1, 2],
      [2, 0],
    ]) {
      const a = indices[i + j],
        b = indices[i + k],
        p = pos[a],
        q = pos[b],
        d = q.map((v, n) => v - p[n]);
      let kind, along;
      if (
        p[1] < -1.05 &&
        q[1] < -1.05 &&
        Math.abs(d[0]) + Math.abs(d[2]) < 1e-5 &&
        Math.abs(d[1]) > 0.15
      ) {
        kind = "leg";
        along = d[1];
      } else if (Math.abs(d[1]) < 1e-5 && p[1] > -1 && p[1] < 0.75) {
        if (
          p[2] > 3 &&
          q[2] > 3 &&
          Math.abs(p[0]) < 6 &&
          Math.abs(q[0]) < 6 &&
          Math.abs(d[2]) < 1e-5 &&
          Math.abs(d[0]) > 0.2
        ) {
          kind = "front";
          along = d[0];
        } else if (
          Math.abs(p[0]) > 5.5 &&
          Math.abs(q[0]) > 5.5 &&
          Math.abs(p[2]) < 3.5 &&
          Math.abs(q[2]) < 3.5 &&
          Math.abs(d[0]) < 1e-5 &&
          Math.abs(d[2]) > 0.2
        ) {
          kind = "side";
          along = d[2];
        }
      }
      if (!kind) continue;
      assert(
        Math.abs(Math.abs((uv[b][0] - uv[a][0]) / along) - 1.25) < 1e-4,
        kind + " grain direction/scale",
      );
      assert(Math.abs(uv[b][1] - uv[a][1]) < 1e-4, kind + " cross-grain scale");
      counts[kind]++;
    }
  }
  for (const [kind, count] of Object.entries(counts))
    assert(count > 0, "inspected " + kind);
});

test("active wood UV1 has no stretched or collapsed triangles; protected sources retain hashes", async () => {
  const { createHash } = await import("node:crypto");
  const { pos, uv, indices } = await exportedWood();
  let checked = 0;
  for (let i = 0; i < indices.length; i += 3) {
    const [a, b, c] = indices.slice(i, i + 3),
      ab = pos[b].map((v, j) => v - pos[a][j]),
      ac = pos[c].map((v, j) => v - pos[a][j]);
    const area = Math.hypot(
      ab[1] * ac[2] - ab[2] * ac[1],
      ab[2] * ac[0] - ab[0] * ac[2],
      ab[0] * ac[1] - ab[1] * ac[0],
    );
    // Miter intersections can triangulate nearly collinear n-gon vertices.
    // Float32 roundoff dominates UV/position area ratios below 1e-6 units².
    if (area < 1e-6) continue;
    const u = uv[b].map((v, j) => v - uv[a][j]),
      v = uv[c].map((v, j) => v - uv[a][j]);
    const ratio = Math.abs(u[0] * v[1] - u[1] * v[0]) / area;
    assert(
      ratio > 0.35 && ratio < 1.7,
      `wood triangle ${i / 3} UV density ${ratio}`,
    );
    checked++;
  }
  assert(checked > 1000);
  const stats = JSON.parse(
    await readFile(
      new URL(
        "../public/assets/table-player-rails-optimized-stats.json",
        import.meta.url,
      ),
    ),
  );
  assert.equal(stats.woodUV.version, 2);
  assert.equal(stats.after.triangles, 34508);
  assert.equal(stats.after.materialPrimitives, 7);
  for (const [name, hash] of Object.entries(stats.preservedSha256)) {
    assert.equal(
      createHash("sha256")
        .update(await readFile(new URL("../" + name, import.meta.url)))
        .digest("hex"),
      hash,
      name,
    );
  }
});
