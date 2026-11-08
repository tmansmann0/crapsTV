import * as THREE from "three";
export const BOARD_WORLD_WIDTH = 10.84;
export const BOARD_WORLD_DEPTH = 5.4;

/** Precompiled SVG contours, source-encoded colours and isolated paint IDs. */
export function readBoardVector(buffer) {
  const header = new DataView(buffer);
  if (header.getUint32(0, true) !== 0x32425643)
    throw Error("Invalid vector board header");
  const count = header.getUint32(4, true),
    indexCount = header.getUint32(8, true);
  const width = header.getUint32(12, true),
    height = header.getUint32(16, true),
    paintCount = header.getUint32(20, true),
    logoPaint = header.getUint32(24, true);
  if (
    width !== 2048 ||
    height !== 1024 ||
    paintCount >= 1024 ||
    buffer.byteLength !== 32 + count * 20 + indexCount * 4
  )
    throw Error("Invalid vector board lengths");
  const xy = new Float32Array(buffer, 32, count * 2),
    color = new Uint16Array(buffer, 32 + count * 8, count * 4),
    paints = new Uint32Array(buffer, 32 + count * 16, count);
  const indices = new Uint32Array(buffer, 32 + count * 20, indexCount),
    positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++)
    positions.set(
      [
        (xy[i * 2] / width - 0.5) * BOARD_WORLD_WIDTH,
        (0.5 - xy[i * 2 + 1] / height) * BOARD_WORLD_DEPTH,
        0,
      ],
      i * 3,
    );
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(color, 4, true));
  geometry.setAttribute(
    "paint",
    new THREE.BufferAttribute(Float32Array.from(paints), 1),
  );
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  geometry.userData.vectorBoard = {
    vertices: count,
    triangles: indexCount / 3,
    width,
    height,
    paintCount,
    logoPaint,
  };
  return geometry;
}
