import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { createBoardMaterial } from "../src/board-material.js";
import { applySurfaceProfile } from "../src/surface-profile.js";

test("the actual printed playing plane receives selected C felt without changing its maps", () => {
  const normalMap = new THREE.Texture(),
    roughnessMap = new THREE.Texture();
  const material = createBoardMaterial({ normalMap, roughnessMap });
  assert.equal(material.name, "Printed playing felt");
  assert.equal(material.isMeshPhysicalMaterial, true);
  assert.equal(material.userData.surfaceProfile, "refined");
  assert.deepEqual(material.normalScale.toArray(), [0.6 * 3.6, 0.6 * 3.6]);
  assert.equal(material.sheen, 0.28 * 1.9);
  assert.equal(material.clearcoat, 0);
  assert.equal(material.roughness, 1);
  assert.equal(material.normalMap, normalMap);
  assert.equal(material.roughnessMap, roughnessMap);
  const shader = {
    uniforms: {},
    vertexShader: THREE.ShaderLib.physical.vertexShader,
    fragmentShader: THREE.ShaderLib.physical.fragmentShader,
  };
  material.onBeforeCompile(shader, {});
  assert.equal(shader.uniforms.lookRoughnessContrast.value, 1.7);
  const key = material.customProgramCacheKey();
  applySurfaceProfile(material, "felt");
  assert.equal(material.normalScale.x, 0.6 * 3.6);
  assert.equal(material.sheen, 0.28 * 1.9);
  assert.equal(material.customProgramCacheKey(), key);
  material.dispose();
});

test("raw preview felt stays independent from production and later material creation", () => {
  const raw = createBoardMaterial({ surfaceProfile: false });
  const selected = createBoardMaterial();
  assert.equal(raw.normalScale.x, 0.6);
  assert.equal(raw.sheen, 0.28);
  assert.equal(raw.userData.surfaceProfile, undefined);
  assert.equal(selected.normalScale.x, 0.6 * 3.6);
  assert.equal(
    raw.normalScale.x,
    0.6,
    "new selected material cannot mutate the raw baseline",
  );
  raw.dispose();
  selected.dispose();
});
