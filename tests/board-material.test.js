import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { createBoardMaterial } from "../src/board-material.js";
import { SOFT_WOOL_FELT } from "../src/felt-material.js";

test("printed playing plane uses selected B world-space wool without strand geometry", () => {
  const normalMap = new THREE.Texture(),
    roughnessMap = new THREE.Texture();
  const material = createBoardMaterial({ normalMap, roughnessMap });
  assert.equal(material.name, "Printed playing felt");
  assert.equal(material.isMeshPhysicalMaterial, true);
  assert.equal(material.userData.feltLook, "soft-wool");
  assert.deepEqual(material.normalScale.toArray(), [1, 1]);
  assert.equal(material.sheen, SOFT_WOOL_FELT.sheen);
  assert.equal(material.clearcoat, 0);
  assert.equal(material.roughness, 1);
  assert.equal(material.normalMap, normalMap);
  assert.equal(
    material.roughnessMap,
    null,
    "nap roughness is packed in the wool atlas",
  );
  const shader = {
    uniforms: {},
    vertexShader: THREE.ShaderLib.physical.vertexShader,
    fragmentShader: THREE.ShaderLib.physical.fragmentShader,
  };
  material.onBeforeCompile(shader, {});
  assert.equal(shader.uniforms.feltStudyAtlas.value, normalMap);
  assert.equal(shader.uniforms.feltStudyTile.value, SOFT_WOOL_FELT.tile);
  assert.match(shader.fragmentShader, /float feltClothMask/);
  assert(
    shader.fragmentShader.indexOf("#include <map_fragment>") <
      shader.fragmentShader.indexOf("float feltClothMask"),
    "native ink sampler runs before smooth ink masking",
  );
  assert.match(material.customProgramCacheKey(), /soft-wool-felt-v1/);
  assert(!shader.vertexShader.includes("feltFiber"));
  material.dispose();
});

test("raw historical preview felt stays independent from selected B", () => {
  const raw = createBoardMaterial({ surfaceProfile: false });
  const selected = createBoardMaterial();
  assert.equal(raw.normalScale.x, 0.6);
  assert.equal(raw.sheen, 0.28);
  assert.equal(raw.userData.feltLook, undefined);
  assert.equal(selected.sheen, 0.75);
  assert.equal(selected.userData.feltLook, "soft-wool");
  assert.equal(raw.normalScale.x, 0.6);
  raw.dispose();
  selected.dispose();
});
