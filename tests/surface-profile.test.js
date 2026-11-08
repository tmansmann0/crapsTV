import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import {
  applySurfaceProfile,
  SELECTED_SURFACE_PROFILE,
} from "../src/surface-profile.js";
import { applyChipPatina } from "../src/chip-patina.js";
test("selected shared surfaces are idempotent across repeated setup and uniform refresh", () => {
  const material = new THREE.MeshPhysicalMaterial({
      name: "ChipBase",
      normalScale: new THREE.Vector2(0.38, 0.38),
    }),
    texture = new THREE.Texture();
  applyChipPatina(material, new THREE.Texture());
  applySurfaceProfile(material, "chip", { scratchTexture: texture });
  const hook = material.onBeforeCompile,
    key = material.customProgramCacheKey();
  applySurfaceProfile(material, "chip", { scratchTexture: texture });
  assert.equal(material.onBeforeCompile, hook);
  assert.equal(material.customProgramCacheKey(), key);
  assert.deepEqual(material.normalScale.toArray(), [0.38 * 2.3, 0.38 * 2.3]);
  assert.equal(material.userData.surfaceProfile, SELECTED_SURFACE_PROFILE);
  const shader = {
    uniforms: {},
    vertexShader: THREE.ShaderLib.physical.vertexShader,
    fragmentShader: THREE.ShaderLib.physical.fragmentShader,
  };
  hook(shader, {});
  assert.equal(shader.uniforms.lookRoughnessContrast.value, 1.55);
  assert.equal(shader.uniforms.chipScratchRelief.value, 1);
  assert.equal(shader.uniforms.chipPatinaStrength.value, 1.8);
  assert.equal(shader.uniforms.lookDirtScale.value, 0.87);
  assert.equal(shader.uniforms.lookMacroGrime.value, 0.16 * 0.87);
  assert.equal(shader.uniforms.lookMacroScuff.value, 0.13);
  assert.equal(shader.uniforms.chipScratchAlbedo.value, 0.4);
  assert(
    shader.fragmentShader.includes(
      "chipDirt = clamp(chipDirt, 0.0, 1.0) * lookDirtScale",
    ),
  );
  assert.throws(
    () => applySurfaceProfile(new THREE.MeshStandardMaterial(), "chip"),
    /scratch atlas/,
  );
});
