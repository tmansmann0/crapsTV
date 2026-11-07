import * as THREE from "three";
import { createFeltSurfaceSettings } from "./felt-surface.js";
import { applySurfaceProfile } from "./surface-profile.js";

/** Physical felt under the independently budgeted SVG-sourced ink atlas. */
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
  if (surfaceProfile) applySurfaceProfile(material, "felt");
  return material;
}
