import * as THREE from "three";

// One physical tile is about 13 cm, matching the existing table world scale.
// Short matted fibres affect lighting only; bet coordinates and silhouettes stay fixed.
export const FELT_TILE_SIZE = 0.46;
export const FELT_NORMAL_STRENGTH = 0.6;
export function createFeltSurfaceSettings() {
  return {
    roughness: 1,
    normalScale: new THREE.Vector2(FELT_NORMAL_STRENGTH, FELT_NORMAL_STRENGTH),
    metalness: 0,
    clearcoat: 0,
    sheen: 0.28,
    sheenRoughness: 0.9,
    sheenColor: new THREE.Color("#47775a"),
    envMapIntensity: 0.4,
  };
}
