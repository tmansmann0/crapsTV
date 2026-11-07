import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { createChipBatch } from "../src/chip-batch.js";

function fixture(
  specs = [
    { position: [0, 0, -6], diameter: 1 },
    { position: [0, 0, -100], diameter: 1 },
  ],
) {
  const material = new THREE.MeshStandardMaterial();
  material.name = "ChipBase";
  const source = new THREE.Mesh(new THREE.BoxGeometry(1, 0.1, 1), material);
  source.position.x = 0.05;
  source.updateMatrixWorld(true);
  const low = new THREE.BoxGeometry(1, 0.1, 1);
  const group = createChipBatch(
    specs,
    [source],
    () => material,
    new Map([[material.name, low]]),
  );
  const camera = new THREE.PerspectiveCamera(45, 16 / 9, 0.1, 500);
  camera.updateMatrixWorld(true);
  return { group, batch: group.userData.chipBatch, camera, source, low, specs };
}
function closeMatrix(actual, expected) {
  actual.elements.forEach((value, i) =>
    assert.ok(Math.abs(value - expected.elements[i]) < 1e-5),
  );
}

test("near and far chips in one material batch independently select their geometry", () => {
  const { group, batch, camera, source, low } = fixture();
  assert.equal(batch.update(camera, 1080), true);
  assert.deepEqual(batch.stats(), { high: 1, low: 1 });
  assert.equal(group.children[0].geometry, low);
  assert.equal(group.children[1].geometry, source.geometry);
  assert.equal(group.children[0].count, 1);
  assert.equal(group.children[1].count, 1);
  const near = new THREE.Matrix4(),
    far = new THREE.Matrix4();
  group.children[1].getMatrixAt(0, near);
  group.children[0].getMatrixAt(0, far);
  assert.equal(near.elements[14], -6);
  assert.equal(far.elements[14], -100);
});

test("full/optimized overrides keep all source chips and stationary updates do not upload buffers", () => {
  const { group, batch, camera } = fixture();
  batch.update(camera, 1080, "optimized");
  const versions = group.children.map((mesh) => mesh.instanceMatrix.version);
  assert.equal(batch.update(camera, 1080, "optimized"), false);
  assert.deepEqual(
    group.children.map((mesh) => mesh.instanceMatrix.version),
    versions,
  );
  assert.deepEqual(batch.stats(), { high: 0, low: 2 });
  assert.equal(batch.update(camera, 1080, "full"), true);
  assert.deepEqual(batch.stats(), { high: 2, low: 0 });
  assert.equal(group.children[0].visible, false);
  assert.equal(group.children[1].count, 2);
});

test("impact matrix identity survives LOD compaction and restoring the original pose", () => {
  const { group, batch, camera, source } = fixture();
  const base = batch.getMatrixAt(0, new THREE.Matrix4());
  const impacted = new THREE.Matrix4().compose(
    new THREE.Vector3(0.2, 0.16, -120),
    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), 0.2),
    new THREE.Vector3(1, 1, 1),
  );
  batch.update(camera, 1080);
  batch.setMatrixAt(0, impacted);
  batch.update(camera, 1080);
  assert.deepEqual(batch.stats(), { high: 0, low: 2 });
  const rendered = new THREE.Matrix4();
  group.children[0].getMatrixAt(0, rendered);
  closeMatrix(rendered, impacted.clone().multiply(source.matrixWorld));
  batch.setMatrixAt(0, base);
  batch.update(camera, 1080);
  assert.deepEqual(batch.stats(), { high: 1, low: 1 });
  group.children[1].getMatrixAt(0, rendered);
  closeMatrix(rendered, base.clone().multiply(source.matrixWorld));
});

test("LOD hysteresis resists boundary oscillation and uses transformed world depth", () => {
  const { group, batch, camera } = fixture([
    { position: [0, 0, -40], diameter: 1 },
  ]);
  const projection = 1080 / (2 * Math.tan(Math.PI / 8));
  const atPixels = (pixels) => {
    group.position.z = 40 - projection / pixels;
    return batch.update(camera, 1080);
  };
  atPixels(127);
  assert.deepEqual(batch.stats(), { high: 0, low: 1 });
  assert.equal(atPixels(144), false);
  atPixels(161);
  assert.deepEqual(batch.stats(), { high: 1, low: 0 });
  assert.equal(atPixels(144), false);
  atPixels(127);
  assert.deepEqual(batch.stats(), { high: 0, low: 1 });
});

test("impact culling bounds cover both geometry partitions and transparency keeps shadows disabled", () => {
  const { group, batch, camera } = fixture();
  const original = group.children[0].boundingSphere.radius;
  batch.expandBounds(0.44);
  batch.update(camera, 1080);
  for (const mesh of group.children)
    assert.equal(mesh.boundingSphere.radius, original + 0.44);
  const transparent = new THREE.MeshStandardMaterial({
    transparent: true,
    opacity: 0.3,
  });
  const source = new THREE.Mesh(new THREE.BoxGeometry(), transparent);
  source.updateMatrixWorld(true);
  const ghosts = createChipBatch(
    [{ position: [0, 0, -3] }],
    [source],
    () => transparent,
    new Map(),
  );
  for (const mesh of ghosts.children) assert.equal(mesh.castShadow, false);
});

test("patina parameters repack with each chip through LOD and motion without mutating shared geometry", () => {
  const material = new THREE.MeshStandardMaterial();
  material.userData.chipPatina = true;
  const source = new THREE.Mesh(
    new THREE.CylinderGeometry(0.5, 0.5, 0.13, 16),
    material,
  );
  source.updateMatrixWorld(true);
  const low = new THREE.CylinderGeometry(0.5, 0.5, 0.13, 8);
  const specs = [
    { id: "clean", position: [0, 0, -6], diameter: 1 },
    { id: "handled", position: [0, 0, -100], diameter: 1 },
  ];
  const group = createChipBatch(
    specs,
    [source],
    () => material,
    new Map([[material.name, low]]),
  );
  const batch = group.userData.chipBatch,
    camera = new THREE.PerspectiveCamera(45, 16 / 9, 0.1, 500);
  camera.updateMatrixWorld(true);
  const before = group.children[1].instanceColor.array.slice(0, 6);
  batch.update(camera, 1080);
  assert.deepEqual(
    [...group.children[1].instanceColor.array.slice(0, 3)],
    [...before.slice(0, 3)],
  );
  assert.deepEqual(
    [...group.children[0].instanceColor.array.slice(0, 3)],
    [...before.slice(3, 6)],
  );
  const moved = batch.getMatrixAt(0, new THREE.Matrix4());
  moved.setPosition(2, 0, -120);
  batch.setMatrixAt(0, moved);
  batch.update(camera, 1080);
  assert.deepEqual(
    [...group.children[0].instanceColor.array.slice(0, 3)],
    [...before.slice(0, 3)],
  );
  assert.deepEqual(
    [...group.children[0].instanceColor.array.slice(3, 6)],
    [...before.slice(3, 6)],
  );
  assert.equal(source.geometry.attributes.instanceColor, undefined);
  assert.equal(low.attributes.instanceColor, undefined);
  assert.equal(
    group.children.length,
    2,
    "same one material/high-low mesh pair, no variation batches",
  );
});
