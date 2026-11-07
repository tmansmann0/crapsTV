import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import * as THREE from "three";
import { createWoodLookPreview, WOOD_LOOKS } from "../src/wood-look.js";

function fixture() {
  const root = new THREE.Group(),
    wood = new THREE.MeshPhysicalMaterial();
  wood.name = "Hand-polished dark walnut";
  wood.map = new THREE.Texture();
  wood.normalMap = new THREE.Texture();
  wood.roughnessMap = new THREE.Texture();
  wood.aoMap = new THREE.Texture();
  wood.normalScale.set(0.82, 0.82);
  wood.clearcoat = 0.16;
  wood.clearcoatNormalMap = wood.normalMap;
  wood.clearcoatNormalScale.set(0.28, 0.28);
  wood.aoMapIntensity = 0.5;
  root.add(new THREE.Mesh(new THREE.BoxGeometry(), wood));
  const leather = new THREE.MeshStandardMaterial();
  leather.name = "Deep oxblood leather";
  root.add(new THREE.Mesh(new THREE.BoxGeometry(), leather));
  return { root, wood, leather };
}

test("walnut previews preserve model UVs, non-wood materials and shader hooks, restore originals, and dispose owned maps once", async () => {
  const { root, wood, leather } = fixture(),
    original = wood.map,
    normal = wood.normalMap,
    geometry = root.children[0].geometry;
  const uv = geometry.attributes.uv.array.slice(),
    hook = wood.onBeforeCompile;
  const c = await createWoodLookPreview(root, {
    renderer: { capabilities: { getMaxAnisotropy: () => 16 } },
    loadTexture: async () => new THREE.Texture(),
    resolveAsset: (x) => x,
  });
  assert.equal(c.materialCount, 1);
  assert.equal(c.textures.size, 12);
  for (const id of ["american", "smoked", "natural"]) {
    c.apply(id);
    assert.equal(wood.normalMap.channel, 1);
    assert.equal(wood.map.channel, 1);
    assert.equal(wood.map.colorSpace, THREE.SRGBColorSpace);
    assert.equal(wood.normalMap.colorSpace, THREE.NoColorSpace);
    assert.equal(wood.normalMap.repeat.x, 0.8 / 3.6);
    assert.equal(wood.normalMap.repeat.x, wood.normalMap.repeat.y);
    assert.equal(wood.map.repeat.x, wood.roughnessMap.repeat.x);
    assert.equal(wood.normalMap.flipY, false);
    assert.equal(wood.roughness, 1);
    assert.equal(
      wood.clearcoatNormalMap,
      null,
      "smooth varnish rather than embossed pores",
    );
    assert(wood.clearcoat >= 0.3 && wood.clearcoat <= 0.45);
    assert(wood.normalScale.x < 0.4);
    assert.equal(wood.onBeforeCompile, hook);
    assert.equal(root.children[1].material, leather);
    assert.deepEqual(geometry.attributes.uv.array, uv);
    assert.equal(c.describe(id).physicalTileWorldUnits, 3.6);
  }
  let disposed = 0;
  for (const t of c.textures) {
    assert.equal(t.anisotropy, 8);
    t.addEventListener("dispose", () => disposed++);
  }
  c.dispose();
  c.dispose();
  assert.equal(disposed, 12);
  assert.equal(wood.map, original);
  assert.equal(wood.normalMap, normal);
  assert.equal(wood.normalScale.x, 0.82);
  assert.equal(wood.clearcoatNormalMap, normal);
  assert.equal(wood.clearcoat, 0.16);
  assert.throws(() => c.apply("american"), /disposed/);
});

test("partial walnut texture failures dispose successful loads and leave the original material intact", async () => {
  const { root, wood } = fixture(),
    map = wood.map,
    loaded = [];
  await assert.rejects(
    createWoodLookPreview(root, {
      resolveAsset: (x) => x,
      loadTexture: async (path) => {
        if (path.includes("smoked/roughness"))
          throw Error("intentional texture failure");
        const t = new THREE.Texture();
        t.addEventListener("dispose", () => loaded.push(path));
        return t;
      },
    }),
    /intentional texture failure/,
  );
  assert.equal(loaded.length, 11);
  assert.equal(wood.map, map);
});

test("CC0 matched walnut maps retain source hashes, dark linear-light stain, scalar precision and bounded texture sizes", async () => {
  const base = new URL("../", import.meta.url),
    m = JSON.parse(
      await readFile(new URL("public/assets/wood-studies/manifest.json", base)),
    );
  assert.equal(m.license, "CC0-1.0");
  assert.equal(m.licenseUrl, "https://polyhaven.com/license");
  for (const [id, spec] of Object.entries(m.candidates)) {
    assert(WOOD_LOOKS[id]);
    assert.deepEqual(spec.scanDimensionsMillimetres, [1000, 1000]);
    assert.equal(spec.physicalTileWorldUnits, 3.6);
    const roles = Object.keys(spec.files);
    assert.deepEqual(roles, ["albedo", "normal", "roughness", "ao"]);
    for (const data of Object.values(spec.files)) {
      for (const [path, hash] of [
        [data.file, data.sha256],
        [data.runtime, data.runtimeSha256],
      ])
        assert.equal(
          createHash("sha256")
            .update(await readFile(new URL(path, base)))
            .digest("hex"),
          hash,
          path,
        );
      assert(data.width <= 2048 && data.height <= 2048);
    }
    const color = spec.files.albedo.meanRGB;
    assert(
      color[0] < 0.33 && color[1] < 0.22 && color[2] < 0.15,
      "dark warm stain remains dark",
    );
    const rough = spec.files.roughness,
      ao = spec.files.ao;
    assert(
      rough.min > 0.25 && rough.max < 0.55 && rough.max - rough.min > 0.04,
      "16-bit scalar roughness retained instead of clipped white",
    );
    assert(
      ao.min < 0.65 && ao.max > 0.98,
      "scanned pore occlusion retains meaningful variation",
    );
    const source = await readFile(new URL(spec.files.roughness.file, base));
    assert.equal(
      source[24],
      16,
      "tested source actually has 16-bit scalar precision",
    );
  }
  for (const [path, hash] of Object.entries(m.preservedRuntimeWoodSha256))
    assert.equal(
      createHash("sha256")
        .update(await readFile(new URL(path, base)))
        .digest("hex"),
      hash,
      "original wood remains available for rollback",
    );
});
