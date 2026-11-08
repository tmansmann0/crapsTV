import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import * as THREE from "three";
import {
  createFeltStudy,
  createFeltFuzzLayer,
  FELT_STUDIES,
} from "../src/felt-study.js";

test("felt prototypes vary independent fibre/nap response, retain paint UVs and restore authored materials", () => {
  const atlas = new THREE.Texture(),
    normal = new THREE.Texture(),
    rough = new THREE.Texture(),
    print = new THREE.Texture();
  const material = new THREE.MeshPhysicalMaterial({
    map: print,
    normalMap: normal,
    roughnessMap: rough,
    normalScale: new THREE.Vector2(0.6, 0.6),
    sheen: 0.532,
    sheenColor: "#47775a",
    sheenRoughness: 0.9,
  });
  const hook = material.onBeforeCompile,
    key = material.customProgramCacheKey,
    study = createFeltStudy(material, atlas);
  const shader = {
    vertexShader: THREE.ShaderLib.physical.vertexShader,
    fragmentShader: THREE.ShaderLib.physical.fragmentShader,
    uniforms: {},
  };
  material.onBeforeCompile(shader, {});
  assert.match(shader.fragmentShader, /vFeltStudyWorld.xz\/feltStudyTile/);
  assert.match(shader.fragmentShader, /feltClothMask/);
  assert.match(shader.fragmentShader, /feltViewSlope/);
  assert(!shader.fragmentShader.includes("#include <normal_fragment_maps>"));
  const keys = new Set();
  for (const id of Object.keys(FELT_STUDIES)) {
    study.apply(id);
    keys.add(material.customProgramCacheKey());
    assert.equal(material.map, print, "printed artwork is untouched");
    assert.equal(shader.uniforms.feltStudyAtlas.value, atlas);
    assert.equal(shader.uniforms.feltStudyTile.value, FELT_STUDIES[id].tile);
    assert.equal(material.sheen, FELT_STUDIES[id].sheen);
    assert.equal(material.clearcoat, 0);
  }
  assert.equal(keys.size, 1, "same program across options");
  assert(FELT_STUDIES.plush.sheen > FELT_STUDIES.fine.sheen);
  assert(FELT_STUDIES.nap.nap > FELT_STUDIES.plush.nap);
  study.dispose();
  study.dispose();
  assert.equal(material.onBeforeCompile, hook);
  assert.equal(material.customProgramCacheKey, key);
  assert.equal(material.normalMap, normal);
  assert.equal(material.roughnessMap, rough);
  assert.equal(material.map, print);
  assert.deepEqual(material.normalScale.toArray(), [0.6, 0.6]);
  assert.equal(material.sheen, 0.532);
  assert.equal(material.sheenRoughness, 0.9);
  assert.throws(() => study.apply("fine"), /disposed/);
});

test("optional microfibres remain one bounded batch, deterministic, painted-ink masked and distance culled", () => {
  const print = new THREE.Texture(),
    a = createFeltFuzzLayer(print),
    b = createFeltFuzzLayer(print);
  assert.deepEqual(
    a.mesh.geometry.attributes.feltFiber.array,
    b.mesh.geometry.attributes.feltFiber.array,
  );
  assert.equal(a.mesh.geometry.attributes.feltFiber.count, 50000);
  assert.equal(a.mesh.material.forceSinglePass, true);
  assert.equal(a.mesh.material.depthTest, true);
  assert.equal(a.mesh.material.depthWrite, false);
  assert.match(a.mesh.material.fragmentShader, /cloth/);
  assert.match(a.mesh.material.vertexShader, /position.y\*feltFuzzHeight/);
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(0, 0.5, 2);
  a.apply("fine", camera);
  assert.equal(a.triangles, 0);
  a.apply("plush", camera);
  assert.equal(a.triangles, 0, "selected B has no raised strands");
  a.apply("nap", camera);
  assert.equal(a.triangles, 100000);
  camera.position.set(0, 4, 7);
  a.apply("nap", camera);
  assert.equal(a.triangles, 0);
  a.dispose();
  b.dispose();
});

test("fibre atlas has bounded resolution and original seeded fibre construction, without displacement", async () => {
  const metadata = JSON.parse(
    await readFile(
      new URL("../public/assets/felt-studies/metadata.json", import.meta.url),
    ),
  );
  const bytes = await readFile(
    new URL("../public/assets/felt-studies/wool-fibres.png", import.meta.url),
  );
  assert.equal(bytes.readUInt32BE(16), 1024);
  assert.equal(bytes.readUInt32BE(20), 1024);
  assert.equal(bytes[25], 6, "packed RGBA data");
  assert.equal(
    createHash("sha256").update(bytes).digest("hex"),
    metadata.sha256,
  );
  assert.equal(metadata.geometryAdded, false);
  assert.equal(metadata.physicalDisplacement, false);
  assert.equal(metadata.fibres, 19000);
});
