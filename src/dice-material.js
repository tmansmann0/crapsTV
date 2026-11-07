import * as THREE from "three";
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
export function createDiceMaterial(appearance, normalMap, roughnessMap) {
  const translucent = appearance.finish === "translucent",
    color = DICE_COLORS[appearance.color] || DICE_COLORS.red;
  return new THREE.MeshPhysicalMaterial({
    name: "DiceBody",
    color,
    roughness: translucent ? 0.14 : 0.27,
    metalness: 0,
    normalMap,
    normalScale: new THREE.Vector2(0.27, 0.27),
    roughnessMap,
    clearcoat: 1,
    clearcoatRoughness: 0.12,
    transmission: translucent ? 0.82 : 0,
    thickness: 0.16,
    ior: 1.48,
    attenuationColor: new THREE.Color(color),
    attenuationDistance: 0.7,
    envMapIntensity: 1.1,
  });
}
