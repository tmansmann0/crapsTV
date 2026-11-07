import * as THREE from "three";

const MAPS = {
  woodColor: ["material-table-walnut-albedo.jpg", true, 1],
  woodNormal: ["material-table-walnut-normal.png", false, 1],
  woodRough: ["material-table-walnut-roughness.png", false, 1],
  leatherColor: ["material-table-leather-albedo.png", true, 0],
  leatherNormal: ["material-table-leather-normal.png", false, 1],
  leatherRough: ["material-table-leather-roughness.png", false, 1],
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
const MATERIALS = {
  "Hand-polished dark walnut": {
    color: "woodColor",
    normal: "woodNormal",
    rough: "woodRough",
    strength: 0.55,
    metalness: 0,
    coat: 0.16,
    coatRoughness: 0.38,
    environment: 0.8,
  },
  "Deep oxblood leather": {
    color: "leatherColor",
    normal: "leatherNormal",
    rough: "leatherRough",
    strength: 0.75,
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
    color: "feltColor",
    normal: "feltNormal",
    rough: "feltRough",
    strength: 0.26,
    metalness: 0,
    coat: 0,
    environment: 0.4,
  },
  "Player tray suede": {
    color: "feltColor",
    normal: "feltNormal",
    rough: "feltRough",
    strength: 0.32,
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
  } = {},
) {
  if (!resolveAsset) {
    const { assetURL } = await import("./asset-url.js");
    resolveAsset = assetURL;
  }
  const textures = new Set();
  const maps = {};
  const anisotropy = Math.min(
    8,
    renderer?.capabilities?.getMaxAnisotropy?.() || 1,
  );
  const loaded = await Promise.allSettled(
    Object.entries(MAPS).map(async ([key, [file, color, channel]]) => {
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
            : "roughness",
      };
      // Matched scanned wood: a 4-unit tile on board-local physical Detail UV.
      // Identical isotropic scale keeps pores proportional on tops/aprons/legs.
      if (key.startsWith("wood")) texture.repeat.set(0.8 / 4, 0.8 / 4);
      // Existing felt fibres were designed as a .46-world-unit tile.
      if (key.startsWith("felt")) texture.repeat.set(0.8 / 0.46, 0.8 / 0.46);
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
    const spec = MATERIALS[original.name];
    if (!spec) return original;
    if (materials.has(original.name)) return materials.get(original.name);
    const material =
      original.name === "Hand-polished dark walnut"
        ? new THREE.MeshPhysicalMaterial()
        : original.clone();
    if (original.name === "Hand-polished dark walnut")
      THREE.MeshStandardMaterial.prototype.copy.call(material, original);
    material.name = original.name;
    material.color.set(spec.tint ?? 0xffffff);
    material.map = maps[spec.color];
    material.normalMap = maps[spec.normal];
    material.normalMapType = THREE.TangentSpaceNormalMap;
    material.normalScale.set(spec.strength, spec.strength);
    material.roughnessMap = maps[spec.rough];
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
    }
    material.userData = {
      ...material.userData,
      tablePBR: true,
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
