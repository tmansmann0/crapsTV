import * as THREE from "three";
import { applySurfaceProfile } from "./surface-profile.js";
export const DICE_COLORS = {
  red: "#9e192d",
  green: "#147553",
  blue: "#195bab",
};
export const diceWearIndex = (playerId, index) =>
  ([...(playerId || "house")].reduce(
    (n, c) => (n * 31 + c.charCodeAt(0)) >>> 0,
    0,
  ) +
    index) %
  3;
export function createDiceMaterial(
  appearance,
  normalMap,
  roughnessMap,
  software = false,
  { surfaceProfile = true } = {},
) {
  const translucent = appearance.finish === "translucent",
    color = DICE_COLORS[appearance.color] || DICE_COLORS.red;
  const material = new THREE.MeshPhysicalMaterial({
    name: "DiceBody",
    color,
    // Three multiplies the map by this value. The authored texture is already
    // resin roughness (~0.24); scaling it by .27 made solid dice mirror-like.
    roughness: roughnessMap
      ? translucent
        ? 0.5
        : 1
      : translucent
        ? 0.12
        : 0.26,
    metalness: 0,
    normalMap,
    normalScale: new THREE.Vector2(
      translucent ? 0.3 : 0.42,
      translucent ? 0.3 : 0.42,
    ),
    // Handling scratches break the coating as well as the underlying resin.
    // A pristine coat over worn resin otherwise hides them in close-up reflections.
    clearcoatNormalMap: software ? null : normalMap,
    clearcoatNormalScale: new THREE.Vector2(0.26, 0.26),
    roughnessMap,
    clearcoat: software ? 0 : translucent ? 0.7 : 0.35,
    clearcoatRoughness: translucent ? 0.14 : 0.2,
    transmission: translucent && !software ? 0.82 : 0,
    transparent: translucent && software,
    opacity: translucent && software ? 0.65 : 1,
    depthWrite: !(translucent && software),
    thickness: 0.16,
    ior: 1.48,
    attenuationColor: new THREE.Color(color),
    attenuationDistance: 0.7,
    envMapIntensity: 1.1,
  });
  if (surfaceProfile) applySurfaceProfile(material, "dice");
  return material;
}
