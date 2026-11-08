import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import * as THREE from "three";

export function exportedWood(
  file = new URL(
    "../../public/assets/table-player-rails-optimized.glb",
    import.meta.url,
  ),
) {
  const bytes = readFileSync(file),
    length = bytes.readUInt32LE(12);
  const gltf = JSON.parse(bytes.subarray(20, 20 + length)),
    bin = bytes.subarray(28 + length);
  function values(index) {
    const a = gltf.accessors[index],
      view = gltf.bufferViews[a.bufferView];
    const width = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[a.type];
    const [read, size] = {
      5126: ["readFloatLE", 4],
      5125: ["readUInt32LE", 4],
      5123: ["readUInt16LE", 2],
      5121: ["readUInt8", 1],
    }[a.componentType];
    return Array.from({ length: a.count }, (_, i) =>
      Array.from({ length: width }, (_, j) =>
        bin[read](
          (view.byteOffset || 0) +
            (a.byteOffset || 0) +
            i * (view.byteStride || width * size) +
            j * size,
        ),
      ),
    );
  }
  const triangles = [];
  function visit(index, parent) {
    const node = gltf.nodes[index],
      local = new THREE.Matrix4().compose(
        new THREE.Vector3(...(node.translation || [0, 0, 0])),
        new THREE.Quaternion(...(node.rotation || [0, 0, 0, 1])),
        new THREE.Vector3(...(node.scale || [1, 1, 1])),
      );
    if (node.matrix) local.fromArray(node.matrix);
    const world = new THREE.Matrix4().multiplyMatrices(parent, local),
      normalMatrix = new THREE.Matrix3().getNormalMatrix(world);
    if (node.mesh !== undefined)
      for (const p of gltf.meshes[node.mesh].primitives) {
        if (gltf.materials[p.material].name !== "Hand-polished dark walnut")
          continue;
        const positions = values(p.attributes.POSITION).map((v) =>
          new THREE.Vector3(...v).applyMatrix4(world),
        );
        const normals = values(p.attributes.NORMAL).map((v) =>
          new THREE.Vector3(...v).applyNormalMatrix(normalMatrix),
        );
        const uv = values(p.attributes.TEXCOORD_1),
          indices = values(p.indices).flat();
        for (let i = 0; i < indices.length; i += 3) {
          const ids = indices.slice(i, i + 3),
            points = ids.map((id) => positions[id]);
          const normal = new THREE.Vector3().crossVectors(
            new THREE.Vector3().subVectors(points[1], points[0]),
            new THREE.Vector3().subVectors(points[2], points[0]),
          );
          const area = normal.length() / 2;
          normal.normalize();
          triangles.push({
            points,
            normals: ids.map((id) => normals[id]),
            uv: ids.map((id) => uv[id]),
            normal,
            area,
            center: points
              .reduce((c, p) => c.add(p), new THREE.Vector3())
              .multiplyScalar(1 / 3),
            attributes: Object.keys(p.attributes),
          });
        }
      }
    for (const child of node.children || []) visit(child, world);
  }
  for (const index of gltf.scenes[gltf.scene || 0].nodes)
    visit(index, new THREE.Matrix4());
  return triangles;
}

// Winding/order/normal splits may change at export; actual physical triangles
// and printed wood cuts must remain identical to the pre-repair model.
export function woodGeometrySignature(triangles) {
  const canonical = triangles
    .map((t) =>
      t.points
        .map((p, i) =>
          [...p.toArray(), ...t.uv[i]].map((v) => v.toFixed(5)).join(","),
        )
        .sort()
        .join("|"),
    )
    .sort()
    .join("\n");
  return createHash("sha256").update(canonical).digest("hex");
}
