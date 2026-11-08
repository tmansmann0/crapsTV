import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { createDiceMaterial } from "../src/dice-material.js";
import {
  createReflectionFinish,
  applyReflectionStrength,
} from "../src/reflection-finish.js";

function fixture() {
  const map = new THREE.Texture(),
    normal = new THREE.Texture(),
    rough = new THREE.Texture();
  const wood = new THREE.MeshPhysicalMaterial({
    name: "Hand-polished dark walnut",
    map,
    normalMap: normal,
    roughnessMap: rough,
    roughness: 1,
    clearcoat: 0.4,
    clearcoatRoughness: 0.3,
    envMapIntensity: 0.85,
  });
  wood.userData.woodLook = "american";
  const dice = createDiceMaterial(
    { color: "red", finish: "solid" },
    normal,
    rough,
  );
  const clay = new THREE.MeshPhysicalMaterial({
    name: "ChipBase",
    roughness: 0.7,
  });
  const felt = new THREE.MeshPhysicalMaterial({
    name: "Printed playing felt",
    roughness: 0.98,
  });
  const root = new THREE.Group();
  for (const m of [wood, dice, clay, felt])
    root.add(new THREE.Mesh(new THREE.BoxGeometry(), m));
  // Shared meshes must not multiply the same finish more than once.
  root.add(new THREE.Mesh(new THREE.BoxGeometry(), wood));
  return { root, wood, dice, clay, felt, map, normal, rough };
}
const properties = (m) => ({
  roughness: m.roughness,
  coat: m.clearcoat,
  coatRough: m.clearcoatRoughness,
  environment: m.envMapIntensity,
});

test("Current is exact; richer finish affects only wood/resin without changing selected detail", () => {
  const f = fixture(),
    before = [f.wood, f.dice, f.clay, f.felt].map(properties);
  const shader = f.dice.onBeforeCompile,
    key = f.dice.customProgramCacheKey,
    normal = f.dice.normalScale.clone(),
    color = f.dice.color.clone();
  const controller = createReflectionFinish(f.root);
  assert.deepEqual([f.wood, f.dice, f.clay, f.felt].map(properties), before);
  assert.equal(controller.describe().materialCount, 2);
  assert.equal(controller.materialCount, 2);
  controller.apply("medium");
  assert.deepEqual(properties(f.wood), {
    roughness: 0.9,
    coat: 0.44,
    coatRough: 0.42,
    environment: 0.85 * 1.08,
  });
  assert.deepEqual(properties(f.dice), {
    roughness: 0.7,
    coat: 0.65,
    coatRough: 0.11,
    environment: 1.1 * 1.15,
  });
  assert.deepEqual([f.clay, f.felt].map(properties), before.slice(2));
  assert.equal(f.wood.map, f.map);
  assert.equal(f.wood.roughnessMap, f.rough);
  assert.equal(f.dice.normalMap, f.normal);
  assert.equal(f.dice.roughnessMap, f.rough);
  assert.equal(f.dice.onBeforeCompile, shader);
  assert.equal(f.dice.customProgramCacheKey, key);
  assert(f.dice.normalScale.equals(normal));
  assert(f.dice.color.equals(color));
  controller.restore();
  assert.deepEqual([f.wood, f.dice, f.clay, f.felt].map(properties), before);
  controller.dispose();
});

test("repeated and switched profiles always derive from the captured baseline", () => {
  const f = fixture(),
    controller = createReflectionFinish(f.root);
  const first = controller.apply("medium");
  controller.apply("polished");
  assert.equal(f.wood.roughness, 0.5);
  assert.equal(f.dice.roughness, 0.48);
  assert(f.wood.clearcoatRoughness < 0.18);
  assert(f.dice.clearcoatRoughness < 0.11);
  assert.deepEqual(controller.apply("medium"), first);
  assert.deepEqual(controller.apply("medium"), first);
  controller.dispose();
  controller.dispose();
  assert.equal(f.wood.envMapIntensity, 0.85);
  assert.equal(f.dice.envMapIntensity, 1.1);
  assert.throws(() => controller.apply("medium"), /disposed/);
});

test("enhanced wood has satin reflections and scan-aligned grain, with exact Off restoration", () => {
  const f = fixture();
  f.wood.normalScale.set(0.34, 0.28);
  f.wood.clearcoatNormalScale.set(0.12, 0.09);
  f.wood.aoMapIntensity = 0.24;
  const normal = f.wood.normalScale.clone(),
    coatNormal = f.wood.clearcoatNormalScale.clone();
  const shader = f.wood.onBeforeCompile,
    albedo = f.wood.map;
  const controller = createReflectionFinish(f.root);
  controller.apply();
  assert(
    f.wood.roughness > 0.7 &&
      f.wood.clearcoat < 0.6 &&
      f.wood.clearcoatRoughness > 0.18,
  );
  assert(f.wood.normalScale.equals(normal.clone().multiplyScalar(1.75)));
  assert.equal(f.wood.clearcoatNormalMap, f.normal);
  assert.equal(f.wood.clearcoatRoughnessMap, f.rough);
  assert(
    f.wood.clearcoatNormalScale.equals(normal.clone().multiplyScalar(0.45)),
  );
  assert.equal(f.wood.aoMapIntensity, 0.24 * 1.3);
  assert.equal(f.wood.onBeforeCompile, shader);
  assert.equal(f.wood.map, albedo);
  const version = f.wood.version;
  controller.apply();
  assert.equal(
    f.wood.version,
    version,
    "stable finish does not recompile each frame",
  );
  controller.restore();
  assert(f.wood.normalScale.equals(normal));
  assert(f.wood.clearcoatNormalScale.equals(coatNormal));
  assert.equal(f.wood.clearcoatNormalMap, null);
  assert.equal(f.wood.clearcoatRoughnessMap, null);
  assert.equal(f.wood.aoMapIntensity, 0.24);
  controller.apply();
  assert(f.wood.normalScale.equals(normal.clone().multiplyScalar(1.75)));
  controller.dispose();
  assert(f.wood.normalScale.equals(normal));
});

test("late dice get the active finish and restore independently; disposed materials unregister", () => {
  const f = fixture(),
    controller = createReflectionFinish(f.root);
  controller.apply("medium");
  const late = createDiceMaterial(
      { color: "blue", finish: "translucent" },
      f.normal,
      f.rough,
    ),
    before = properties(late);
  const group = new THREE.Group();
  group.add(new THREE.Mesh(new THREE.BoxGeometry(), late));
  assert.equal(controller.register(group), 1);
  assert.equal(controller.register(group), 0);
  assert.equal(late.roughness, before.roughness * 0.7);
  controller.restore();
  assert.deepEqual(properties(late), before);
  late.dispose();
  assert.equal(controller.describe().materialCount, 2);
  assert.equal(controller.materialCount, 2);
  controller.dispose();
  assert.equal(controller.materialCount, 0);
});

test("preview convenience changes are reversible and never compound across captures", () => {
  const f = fixture(),
    before = properties(f.wood);
  const a = applyReflectionStrength(f.root, "medium");
  const b = applyReflectionStrength(f.root, "polished");
  assert.equal(a, b);
  applyReflectionStrength(f.root, "current");
  assert.deepEqual(properties(f.wood), before);
  a.dispose();
  const c = applyReflectionStrength(f.root, "medium");
  assert.notEqual(c, a);
  assert.equal(f.wood.roughness, 0.9);
  c.dispose();
});

test("coat define transitions invalidate programs only when coat presence changes", () => {
  const f = fixture();
  f.dice.clearcoat = 0;
  const controller = createReflectionFinish(f.root),
    v = f.dice.version;
  controller.apply("medium");
  assert.equal(f.dice.version, v + 1);
  controller.apply("polished");
  assert.equal(f.dice.version, v + 1);
  controller.restore();
  assert.equal(f.dice.version, v + 2);
  assert.equal(f.dice.clearcoat, 0);
  controller.dispose();
});

test("options factory registers late roots and reapplies its preferred finish after restore", () => {
  const f = fixture(),
    controller = createReflectionFinish({ profile: "polished" });
  assert.equal(controller.describe().materialCount, 0);
  controller.register(f.root);
  assert.equal(
    f.wood.roughness,
    1,
    "registration starts at the exact current finish",
  );
  controller.apply();
  assert.equal(f.wood.roughness, 0.5);
  controller.restore();
  assert.equal(f.wood.roughness, 1);
  controller.apply();
  assert.equal(f.wood.roughness, 0.5);
  controller.dispose();
});
