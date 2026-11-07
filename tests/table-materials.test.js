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
  assert.equal(wood.clearcoat, 0.1);
  assert.equal(wood.clearcoatRoughness, 0.5);
  assert.equal(wood.map.repeat.x, 0.8 / 6);
  assert.equal(wood.normalMap.repeat.x, 0.8 / 6);
  assert.equal(wood.map.channel, 1);
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
  assert.equal(root.children[0].material.clearcoat, 0.1);
  assert.equal(root.children[0].material.side, THREE.DoubleSide);
  assert.equal(root.children[1].material.isMeshPhysicalMaterial, undefined);
  c.dispose();
});
