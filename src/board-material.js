import * as THREE from "three";
import { createFeltSurfaceSettings } from "./felt-surface.js";
import { applySoftWoolFelt } from "./felt-material.js";

/** Selected B soft wool under the independently budgeted SVG-sourced ink.
 * normalMap is the packed wool fibre atlas in production; no strand geometry. */
export function createBoardMaterial({
  normalMap = null,
  roughnessMap = null,
  surfaceProfile = true,
} = {}) {
  const material = new THREE.MeshPhysicalMaterial({
    name: "Printed playing felt",
    color: 0xffffff,
    ...createFeltSurfaceSettings(),
    normalMap,
    roughnessMap,
  });
  if (surfaceProfile) applySoftWoolFelt(material, normalMap);
  return material;
}
