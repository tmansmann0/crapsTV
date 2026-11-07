import * as THREE from "three";

/** Furniture-wood scans for reversible visual studies. The live game does not import this. */
export const WOOD_LOOKS = Object.freeze({
  original: { label: "Original striped veneer", sourceAsset: "dark_wood" },
  american: {
    label: "Dark American walnut",
    sourceAsset: "american_walnut_veneer",
    normal: 0.34,
    clearcoat: 0.4,
    coatRoughness: 0.3,
  },
  smoked: {
    label: "Smoked figured walnut",
    sourceAsset: "smoked_walnut_veneer",
    normal: 0.24,
    clearcoat: 0.34,
    coatRoughness: 0.32,
  },
  natural: {
    label: "Dark natural walnut",
    sourceAsset: "natural_walnut_veneer",
    normal: 0.28,
    clearcoat: 0.38,
    coatRoughness: 0.31,
  },
});
const WOOD = "Hand-polished dark walnut";
const PROPERTIES = [
  "map",
  "normalMap",
  "roughnessMap",
  "aoMap",
  "clearcoatNormalMap",
  "clearcoatRoughnessMap",
  "roughness",
  "aoMapIntensity",
  "clearcoat",
  "clearcoatRoughness",
  "envMapIntensity",
];
const ROLES = ["albedo", "normal", "roughness", "ao"];

export async function createWoodLookPreview(
  root,
  {
    renderer,
    resolveAsset = (path) => `/assets/${path}`,
    loadTexture = (url) => new THREE.TextureLoader().loadAsync(url),
  } = {},
) {
  const materials = new Set();
  root.traverse((object) => {
    for (const material of object.material
      ? Array.isArray(object.material)
        ? object.material
        : [object.material]
      : [])
      if (material.name === WOOD) materials.add(material);
  });
  const records = [...materials].map((material) => ({
    material,
    original: Object.fromEntries(PROPERTIES.map((key) => [key, material[key]])),
    color: material.color.clone(),
    normalScale: material.normalScale.clone(),
    clearcoatNormalScale: material.clearcoatNormalScale.clone(),
  }));
  const maps = {},
    textures = new Set();
  const anisotropy = Math.min(
    8,
    renderer?.capabilities?.getMaxAnisotropy?.() || 1,
  );
  const loaded = await Promise.allSettled(
    Object.keys(WOOD_LOOKS)
      .filter((id) => id !== "original")
      .flatMap((id) =>
        ROLES.map(async (role) => {
          const file = `wood-studies/${id}/${role}.${role === "albedo" ? "jpg" : "png"}`;
          const t = await loadTexture(resolveAsset(file));
          t.name = file;
          t.flipY = false;
          t.channel = 1;
          t.colorSpace =
            role === "albedo" ? THREE.SRGBColorSpace : THREE.NoColorSpace;
          t.wrapS = t.wrapT = THREE.RepeatWrapping;
          t.repeat.setScalar(0.8 / 3.6);
          t.anisotropy = anisotropy;
          t.userData = {
            ...t.userData,
            woodStudy: true,
            physicalTileWorldUnits: 3.6,
            role,
          };
          (maps[id] ??= {})[role] = t;
          textures.add(t);
        }),
      ),
  );
  const failure = loaded.find((result) => result.status === "rejected");
  if (failure) {
    textures.forEach((t) => t.dispose());
    throw failure.reason;
  }
  let disposed = false;
  function apply(id = "original") {
    if (disposed) throw new Error("Wood study controller is disposed");
    const spec = WOOD_LOOKS[id];
    if (!spec) throw new Error(`Unknown wood look: ${id}`);
    for (const {
      material,
      original,
      color,
      normalScale,
      clearcoatNormalScale,
    } of records) {
      Object.assign(material, original);
      material.color.copy(color);
      material.normalScale.copy(normalScale);
      material.clearcoatNormalScale.copy(clearcoatNormalScale);
      if (id !== "original") {
        const map = maps[id];
        material.color.set(0xffffff);
        material.map = map.albedo;
        material.normalMap = map.normal;
        material.normalScale.setScalar(spec.normal);
        material.roughnessMap = map.roughness;
        material.aoMap = map.ao;
        material.aoMapIntensity = 0.24;
        material.roughness = 1;
        // Thin polished varnish fills most pores; it is a separate, smoother
        // interface rather than an embossed copy of the substrate normal.
        material.clearcoat = spec.clearcoat;
        material.clearcoatRoughness = spec.coatRoughness;
        material.clearcoatNormalMap = null;
        material.clearcoatNormalScale.setScalar(0);
        material.clearcoatRoughnessMap = null;
        material.envMapIntensity = 0.85;
      }
      material.needsUpdate = true;
    }
    return spec;
  }
  return {
    apply,
    textures,
    describe: (id) => ({
      ...WOOD_LOOKS[id],
      id,
      physicalTileWorldUnits: id === "original" ? 4 : 3.6,
      source: `https://polyhaven.com/a/${WOOD_LOOKS[id].sourceAsset}`,
      license: "CC0-1.0",
    }),
    get materialCount() {
      return materials.size;
    },
    dispose() {
      if (disposed) return;
      apply("original");
      textures.forEach((t) => t.dispose());
      disposed = true;
    },
  };
}
