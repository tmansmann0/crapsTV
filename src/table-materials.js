import * as THREE from "three";
import { createFeltSurfaceSettings, FELT_TILE_SIZE } from "./felt-surface.js";
import { applySurfaceProfile } from "./surface-profile.js";

const MAPS = {
  woodColor: ["material-table-walnut-albedo.jpg", true, 1],
  woodNormal: ["material-table-walnut-normal.png", false, 1],
  woodRough: ["material-table-walnut-roughness.png", false, 1],
  woodAO: ["material-table-walnut-occlusion.png", false, 1],
  leatherColor: ["material-table-leather-albedo.png", true, 0],
  leatherNormal: ["material-table-leather-normal.png", false, 1],
  leatherRough: ["material-table-leather-roughness.png", false, 1],
  leatherAO: ["material-table-leather-occlusion.png", false, 1],
  rubberColor: ["material-table-rubber-albedo.png", true, 1],
  rubberNormal: ["table-rubber-normal.png", false, 1],
  rubberRough: ["material-table-rubber-roughness.png", false, 1],
  feltColor: ["material-table-felt-albedo.png", true, 1],
  feltNormal: ["felt-normal.png", false, 1],
  feltRough: ["felt-roughness.png", false, 1],
  brassColor: ["material-table-brass-albedo.png", true, 1],
  brassNormal: ["material-table-brass-normal.png", false, 1],
  brassRough: ["material-table-brass-roughness.png", false, 1],
  blackColor: ["material-table-black-albedo.png", true, 1],
  blackNormal: ["material-table-black-normal.png", false, 1],
  blackRough: ["material-table-black-roughness.png", false, 1],
};
// Keep the original maps for reproducible A–D comparisons. Production loads
// only the selected four American walnut maps, never all preview candidates.
const SELECTED_WOOD_MAPS = {
  woodColor: ["wood-studies/american/albedo.jpg", true, 1],
  woodNormal: ["wood-studies/american/normal.png", false, 1],
  woodRough: ["wood-studies/american/roughness.png", false, 1],
  woodAO: ["wood-studies/american/ao.png", false, 1],
};
const SELECTED_WOOD = {
  strength: 0.34,
  occlusionStrength: 0.24,
  coat: 0.4,
  coatRoughness: 0.3,
  coatNormalStrength: 0,
  environment: 0.85,
};
const MATERIALS = {
  "Hand-polished dark walnut": {
    color: "woodColor",
    normal: "woodNormal",
    rough: "woodRough",
    strength: 0.82,
    occlusion: "woodAO",
    occlusionStrength: 0.5,
    metalness: 0,
    coat: 0.16,
    coatRoughness: 0.38,
    coatNormalStrength: 0.28,
    environment: 0.8,
  },
  "Deep oxblood leather": {
    color: "leatherColor",
    normal: "leatherNormal",
    rough: "leatherRough",
    strength: 1,
    occlusion: "leatherAO",
    occlusionStrength: 0.55,
    metalness: 0,
    coat: 0.015,
    environment: 0.45,
  },
  "Dark pine pyramid bounce rubber": {
    color: "rubberColor",
    normal: "rubberNormal",
    rough: "rubberRough",
    strength: 1,
    metalness: 0,
    coat: 0,
    environment: 0.35,
  },
  "Aged champagne brass": {
    color: "brassColor",
    normal: "brassNormal",
    rough: "brassRough",
    strength: 0.3,
    metalness: 0.88,
    coat: 0,
    environment: 0.65,
  },
  "Dark recessed cup wells": {
    color: "blackColor",
    normal: "blackNormal",
    rough: "blackRough",
    strength: 0.4,
    metalness: 0,
    coat: 0,
    environment: 0.3,
  },
  "Deep pine baize": {
    felt: true,
    color: "feltColor",
    normal: "feltNormal",
    rough: "feltRough",
    strength: 0.6,
    metalness: 0,
    coat: 0,
    environment: 0.4,
  },
  "Player tray suede": {
    felt: true,
    color: "feltColor",
    normal: "feltNormal",
    rough: "feltRough",
    strength: 0.45,
    metalness: 0,
    coat: 0,
    environment: 0.3,
    tint: 0x8ca89a,
  },
};

/**
 * Load every PBR map before adding a table to its scene. UV0 is the continuous
 * colour atlas for leather; wood uses matched scan maps on physical Detail UV,
 * including the original rubber bake.
 * Register controller.textures with the caller's texture-quality controller.
 * The separately drawn printed playing felt is deliberately untouched.
 */
export async function createTableMaterials(
  renderer,
  {
    loadTexture = (url) => new THREE.TextureLoader().loadAsync(url),
    resolveAsset,
    surfaceProfile = true,
  } = {},
) {
  if (!resolveAsset) {
    const { assetURL } = await import("./asset-url.js");
    resolveAsset = assetURL;
  }
  const activeMaps = surfaceProfile ? { ...MAPS, ...SELECTED_WOOD_MAPS } : MAPS;
  const textures = new Set();
  const maps = {};
  const anisotropy = Math.min(
    8,
    renderer?.capabilities?.getMaxAnisotropy?.() || 1,
  );
  const loaded = await Promise.allSettled(
    Object.entries(activeMaps).map(async ([key, [file, color, channel]]) => {
      const texture = await loadTexture(resolveAsset(file));
      texture.name = file;
      texture.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      texture.flipY = false;
      texture.channel = channel;
      texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
      texture.anisotropy = anisotropy;
      texture.userData = {
        ...texture.userData,
        tableMaterial: true,
        role: color
          ? "albedo"
          : key.endsWith("Normal")
            ? "normal"
            : key.endsWith("AO")
              ? "occlusion"
              : "roughness",
      };
      // Matched scan at its one-metre physical tile (3.6 scene units).
      // Original comparison mode retains the former four-unit veneer tile.
      // Identical isotropic scale keeps pores proportional on tops/aprons/legs.
      if (key.startsWith("wood")) {
        const tile = surfaceProfile ? 3.6 : 4;
        texture.repeat.setScalar(0.8 / tile);
      }
      // Existing felt fibres were designed as a .46-world-unit tile.
      if (key.startsWith("felt"))
        texture.repeat.set(0.8 / FELT_TILE_SIZE, 0.8 / FELT_TILE_SIZE);
      maps[key] = texture;
      textures.add(texture);
    }),
  );
  const failure = loaded.find((result) => result.status === "rejected");
  if (failure) {
    textures.forEach((texture) => texture.dispose());
    throw failure.reason;
  }
  const materials = new Map();
  let disposed = false;
  function replacement(original) {
    const baseSpec = MATERIALS[original.name];
    if (!baseSpec) return original;
    const wood = original.name === "Hand-polished dark walnut";
    const spec =
      wood && surfaceProfile ? { ...baseSpec, ...SELECTED_WOOD } : baseSpec;
    if (materials.has(original.name)) return materials.get(original.name);
    const physical = original.name === "Hand-polished dark walnut" || spec.felt;
    const material = physical
      ? new THREE.MeshPhysicalMaterial()
      : original.clone();
    if (physical)
      THREE.MeshStandardMaterial.prototype.copy.call(material, original);
    if (spec.felt) material.setValues(createFeltSurfaceSettings());
    material.name = original.name;
    material.color.set(spec.tint ?? 0xffffff);
    material.map = maps[spec.color];
    material.normalMap = maps[spec.normal];
    material.normalMapType = THREE.TangentSpaceNormalMap;
    material.normalScale.set(spec.strength, spec.strength);
    material.roughnessMap = maps[spec.rough];
    // AO is only the shallow pores, not baked scene lighting. It shares the
    // surface detail UV and remains deliberately weak under the real HDRI.
    material.aoMap = maps[spec.occlusion] ?? null;
    material.aoMapIntensity = spec.occlusionStrength ?? 1;
    // Map texels already encode the desired roughness. Multiplying by another
    // .5 scalar would turn satin wood into an unintended glossy surface.
    material.roughness = 1;
    material.metalness = spec.metalness;
    material.metalnessMap = null;
    material.envMapIntensity = spec.environment;
    if ("clearcoat" in material) {
      material.clearcoat = spec.coat;
      material.clearcoatRoughness = spec.coatRoughness ?? 0.75;
      material.clearcoatMap = null;
      material.clearcoatRoughnessMap = null;
      // American walnut uses the chosen smooth varnish over fine substrate
      // pores. Legacy comparison mode retains its original pore-following coat.
      material.clearcoatNormalMap = spec.coatNormalStrength
        ? maps[spec.normal]
        : null;
      material.clearcoatNormalScale.set(
        spec.coatNormalStrength ?? 0,
        spec.coatNormalStrength ?? 0,
      );
    }
    if (
      surfaceProfile &&
      (spec.felt || original.name === "Deep oxblood leather")
    )
      applySurfaceProfile(material, spec.felt ? "felt" : "padding");
    material.userData = {
      ...material.userData,
      tablePBR: true,
      selectedSurfaceProfile: Boolean(surfaceProfile),
      ...(wood ? { woodLook: surfaceProfile ? "american" : "original" } : {}),
      roughnessEncodedInMap: true,
    };
    material.needsUpdate = true;
    materials.set(original.name, material);
    return material;
  }
  return {
    textures,
    apply(root) {
      if (disposed) throw new Error("Table material controller is disposed.");
      root.traverse((object) => {
        if (!object.isMesh || !object.material) return;
        object.material = Array.isArray(object.material)
          ? object.material.map(replacement)
          : replacement(object.material);
      });
      return root;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      materials.forEach((material) => material.dispose());
      textures.forEach((texture) => texture.dispose());
      materials.clear();
      textures.clear();
    },
  };
}
