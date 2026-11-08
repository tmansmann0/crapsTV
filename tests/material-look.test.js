import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { applyChipPatina } from "../src/chip-patina.js";
import {
  MATERIAL_LOOKS,
  createMaterialLookController,
} from "../src/material-look.js";
function fixture() {
  const root = new THREE.Group();
  for (const name of [
    "Hand-polished dark walnut",
    "Deep oxblood leather",
    "Deep pine baize",
    "ChipBase",
    "ChipEngraving",
  ]) {
    const material = new THREE.MeshPhysicalMaterial({
      name,
      normalScale: new THREE.Vector2(0.3, 0.4),
      clearcoatNormalScale: new THREE.Vector2(0.2, 0.3),
      aoMapIntensity: 0.5,
      sheen: 0.28,
    });
    if (name.startsWith("Chip"))
      applyChipPatina(
        material,
        new THREE.Texture(),
        name === "ChipEngraving" ? 0.42 : 1,
      );
    root.add(new THREE.Mesh(new THREE.BoxGeometry(), material));
  }
  root.add(
    new THREE.Mesh(root.children[3].geometry, root.children[3].material),
  );
  return root;
}
test("preview choices progress visibly from current to exaggerated, with no production changes", () => {
  const variants = ["baseline", "enhanced", "pronounced", "bold"].map(
    (id) => MATERIAL_LOOKS[id],
  );
  for (const kind of ["wood", "padding", "felt", "chip"]) {
    assert.equal(variants[0][kind].normal, 1);
    for (let i = 1; i < variants.length; i++)
      assert(variants[i][kind].normal > variants[i - 1][kind].normal);
  }
  assert.equal(variants[0].chip.macroGrime, 0);
  assert(variants[3].chip.macroGrime > 0.5);
  assert(variants[3].chip.centerGrime > 2);
});

test("revised mix holds chosen felt, padding and grime fixed while scratches change", () => {
  const {
    mixed,
    refined,
    "scratch-forward": strong,
    enhanced,
    pronounced,
  } = MATERIAL_LOOKS;
  for (const profile of [mixed, refined, strong]) {
    assert.deepEqual(profile.felt, pronounced.felt);
    assert.deepEqual(profile.padding, enhanced.padding);
    assert.equal(profile.chip.grime, enhanced.chip.grime);
    assert.equal(profile.chip.macroGrime, enhanced.chip.macroGrime);
    assert.equal(profile.chip.dirtScale, 0.87);
    assert(
      profile.chip.normal > enhanced.chip.normal &&
        profile.chip.normal < pronounced.chip.normal,
    );
  }
  assert.equal(mixed.chip.scratch.relief, 0);
  assert(
    refined.chip.scratch.relief > 0 &&
      strong.chip.scratch.relief > refined.chip.scratch.relief,
  );
});
test("look swaps are noncumulative and preserve shared geometry/materials exactly", () => {
  const root = fixture(),
    material = root.children[0].material;
  const geometry = root.children[0].geometry,
    positions = geometry.attributes.position.array.slice();
  const controller = createMaterialLookController(root);
  assert.equal(controller.materialCount, 5);
  controller.apply("bold");
  const bold = material.normalScale.clone();
  controller.apply("enhanced");
  controller.apply("bold");
  assert.deepEqual(material.normalScale, bold);
  assert.equal(root.children[3].material, root.children[5].material);
  controller.apply("baseline");
  assert.deepEqual(material.normalScale, new THREE.Vector2(0.3, 0.4));
  assert.equal(material.aoMapIntensity, 0.5);
  assert.deepEqual(geometry.attributes.position.array, positions);
  controller.dispose();
  assert.throws(() => controller.apply("bold"), /disposed/);
});
test("patina preview reaches engraved centers and updates compiled shader uniforms without shader variants", () => {
  const root = fixture(),
    material = root.children[4].material;
  const oldHook = material.onBeforeCompile,
    oldKey = material.customProgramCacheKey;
  const controller = createMaterialLookController(root);
  const key = material.customProgramCacheKey();
  const shader = {
    uniforms: {},
    vertexShader: THREE.ShaderLib.physical.vertexShader,
    fragmentShader: THREE.ShaderLib.physical.fragmentShader,
  };
  material.onBeforeCompile(shader, {});
  assert.equal(shader.uniforms.chipPatinaStrength.value, 0.42);
  assert.equal(shader.uniforms.lookMacroGrime.value, 0);
  controller.apply("bold");
  assert.equal(shader.uniforms.chipPatinaStrength.value, 0.42 * 4.5 * 2.1);
  assert(shader.uniforms.lookMacroGrime.value > 0.6);
  assert(shader.fragmentShader.includes("lookStain"));
  const clamp = shader.fragmentShader.indexOf("chipDirt = clamp");
  assert(
    clamp > 0 &&
      clamp < shader.fragmentShader.indexOf("diffuseColor.rgb *= mix"),
  );
  assert.equal(material.customProgramCacheKey(), key);
  controller.dispose();
  assert.equal(material.onBeforeCompile, oldHook);
  assert.equal(material.customProgramCacheKey, oldKey);
});
