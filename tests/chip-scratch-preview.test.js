import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import * as THREE from "three";
import { applyChipPatina } from "../src/chip-patina.js";
import {
  createMaterialLookController,
  MATERIAL_LOOKS,
} from "../src/material-look.js";
import { createChipScratchPreview } from "../src/chip-scratch-preview.js";
test("scratch study composes relief over logo normal and leaves dirt independently controlled", () => {
  const root = new THREE.Group();
  const material = new THREE.MeshStandardMaterial({ name: "ChipEngraving" });
  applyChipPatina(material, new THREE.Texture(), 0.42);
  root.add(new THREE.Mesh(new THREE.BoxGeometry(), material));
  const look = createMaterialLookController(root),
    oldHook = material.onBeforeCompile;
  const scratches = createChipScratchPreview(root, new THREE.Texture());
  const shader = {
    uniforms: {},
    vertexShader: THREE.ShaderLib.standard.vertexShader,
    fragmentShader: THREE.ShaderLib.standard.fragmentShader,
  };
  material.onBeforeCompile(shader, {});
  look.apply("mixed");
  scratches.apply(MATERIAL_LOOKS.mixed.chip.scratch);
  const grime = shader.uniforms.chipPatinaStrength.value;
  assert.equal(shader.uniforms.chipScratchRelief.value, 0);
  scratches.apply(MATERIAL_LOOKS.refined.chip.scratch);
  assert(shader.uniforms.chipScratchRelief.value > 0);
  assert.equal(shader.uniforms.chipPatinaStrength.value, grime);
  assert(
    shader.fragmentShader.indexOf("vec4 scratchSample=") <
      shader.fragmentShader.indexOf("#include <normal_fragment_maps>"),
  );
  assert(
    shader.fragmentShader.includes(
      "normal=normalize(normal+tbn*vec3(scratchSlope,0.0))",
    ),
  );
  assert.equal(scratches.materialCount, 1);
  scratches.dispose();
  assert.equal(material.onBeforeCompile, oldHook);
  look.dispose();
});
test("one shared scratch atlas contains sparse scored clay rather than widespread grime", async () => {
  const path = new URL(
    "../public/assets/chip-scratch-study.png",
    import.meta.url,
  );
  const bytes = await readFile(path);
  assert.equal(bytes.readUInt32BE(16), 1024);
  assert.equal(bytes.readUInt32BE(20), 1024);
  assert.equal(
    bytes[25],
    6,
    "RGBA stores normals, clay exposure and roughness together",
  );
  const metadata = JSON.parse(
    await readFile(
      new URL(
        "../public/assets/chip-scratch-study-metadata.json",
        import.meta.url,
      ),
    ),
  );
  assert.equal(metadata.sharedTextureCount, 1);
  assert.equal(metadata.productionMapsChanged, false);
  assert(
    metadata.coverageAboveQuarter > 0.015 &&
      metadata.coverageAboveQuarter < 0.06,
  );
  assert(metadata.directionalScores >= 300);
});
