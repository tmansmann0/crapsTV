import * as THREE from "three";

// The 32-sided LOD silhouette deviates by D*(1-cos(pi/32))/2 pixels.
// At 160px diameter that is only 0.386px; above it retain the original model.
// This measures screen error rather than promoting an entire bank at 36px.
export const CHIP_LOD_PIXELS = Object.freeze({ low: 128, high: 160 });

/** Compact high/low instance buffers without changing any chip's source index. */
export function createChipBatch(specs, sources, materialFor, lowGeometry) {
  const group = new THREE.Group();
  const matrices = specs.map((spec) =>
    new THREE.Matrix4().compose(
      new THREE.Vector3(...(spec.position || [0, 0, 0])),
      new THREE.Quaternion().setFromEuler(
        new THREE.Euler(...(spec.rotation || [0, 0, 0])),
      ),
      new THREE.Vector3(
        spec.diameter ?? 0.23,
        (spec.diameter ?? 0.23) * (spec.thicknessScale ?? 1.15),
        spec.diameter ?? 0.23,
      ),
    ),
  );
  const detailed = new Uint8Array(specs.length).fill(1);
  const changedIndices = new Uint8Array(specs.length);
  const dirty = new Set();
  const buckets = new Map();
  const scratch = new THREE.Matrix4();
  const center = new THREE.Vector3(),
    cameraCenter = new THREE.Vector3();
  for (const source of sources) {
    for (const [index, spec] of specs.entries()) {
      const material = materialFor(
        source.material,
        spec.denomination ?? 500,
        (((spec.wear || 0) % 3) + 3) % 3,
        spec.opacity ?? 1,
      );
      const key = `${source.geometry.uuid}/${material.uuid}`;
      if (!buckets.has(key))
        buckets.set(key, { source, material, indices: [] });
      buckets.get(key).indices.push(index);
    }
  }
  for (const bucket of buckets.values()) {
    const low =
      lowGeometry.get(bucket.source.material.name) || bucket.source.geometry;
    bucket.rows = [
      new Int32Array(specs.length).fill(-1),
      new Int32Array(specs.length).fill(-1),
    ];
    bucket.meshes = [low, bucket.source.geometry].map((geometry) => {
      const mesh = new THREE.InstancedMesh(
        geometry,
        bucket.material,
        bucket.indices.length,
      );
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.castShadow = mesh.receiveShadow = !bucket.material.transparent;
      group.add(mesh);
      return mesh;
    });
  }
  function rebuild(bucket) {
    bucket.rows.forEach((rows) => rows.fill(-1));
    const counts = [0, 0];
    for (const index of bucket.indices) {
      const level = detailed[index];
      const row = counts[level]++;
      bucket.rows[level][index] = row;
      bucket.meshes[level].setMatrixAt(
        row,
        scratch.copy(matrices[index]).multiply(bucket.source.matrixWorld),
      );
    }
    bucket.meshes.forEach((mesh, level) => {
      mesh.count = counts[level];
      mesh.visible = mesh.count > 0;
      mesh.instanceMatrix.needsUpdate = true;
    });
  }
  for (const bucket of buckets.values()) {
    rebuild(bucket);
    // Bounds cover every member, not only its current detail partition. Thus
    // switching geometry or moving a chip within its padded impact envelope
    // cannot make a visible chip pop at a stale frustum boundary.
    const full = bucket.meshes[1];
    full.computeBoundingSphere();
    bucket.bounds = full.boundingSphere.clone();
    bucket.meshes.forEach((mesh) => {
      mesh.boundingSphere = bucket.bounds.clone();
    });
  }
  const controller = {
    get count() {
      return specs.length;
    },
    getMatrixAt(index, target) {
      return target.copy(matrices[index]);
    },
    setMatrixAt(index, matrix) {
      matrices[index].copy(matrix);
      dirty.add(index);
    },
    expandBounds(amount) {
      for (const bucket of buckets.values()) {
        bucket.bounds.radius += amount;
        bucket.meshes.forEach((mesh) =>
          mesh.boundingSphere.copy(bucket.bounds),
        );
      }
    },
    update(camera, height, detail = "auto") {
      group.updateWorldMatrix(true, false);
      const projection =
        height / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
      const scale = group.matrixWorld.getMaxScaleOnAxis();
      let changed = false;
      changedIndices.fill(0);
      for (let index = 0; index < specs.length; index++) {
        center
          .setFromMatrixPosition(matrices[index])
          .applyMatrix4(group.matrixWorld);
        cameraCenter.copy(center).applyMatrix4(camera.matrixWorldInverse);
        const pixels =
          cameraCenter.z >= 0
            ? 0
            : ((specs[index].diameter ?? 0.23) * scale * projection) /
              Math.max(0.1, -cameraCenter.z);
        const high =
          detail === "full" ||
          (detail !== "optimized" &&
            (detailed[index]
              ? pixels >= CHIP_LOD_PIXELS.low
              : pixels > CHIP_LOD_PIXELS.high));
        if (Number(high) !== detailed[index]) {
          detailed[index] = Number(high);
          changedIndices[index] = 1;
          changed = true;
        }
      }
      for (const bucket of buckets.values()) {
        if (bucket.indices.some((index) => changedIndices[index]))
          rebuild(bucket);
        else {
          let touchedLow = false,
            touchedHigh = false;
          for (const index of bucket.indices)
            if (dirty.has(index)) {
              const level = detailed[index],
                row = bucket.rows[level][index];
              bucket.meshes[level].setMatrixAt(
                row,
                scratch
                  .copy(matrices[index])
                  .multiply(bucket.source.matrixWorld),
              );
              if (level) touchedHigh = true;
              else touchedLow = true;
            }
          if (touchedLow) bucket.meshes[0].instanceMatrix.needsUpdate = true;
          if (touchedHigh) bucket.meshes[1].instanceMatrix.needsUpdate = true;
        }
      }
      dirty.clear();
      return changed;
    },
    stats() {
      const high = detailed.reduce((sum, value) => sum + value, 0);
      return { high, low: specs.length - high };
    },
  };
  group.userData.chipBatch = controller;
  group.userData.chipCount = specs.length;
  return group;
}
