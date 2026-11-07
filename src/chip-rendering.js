import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { createChipBatch } from "./chip-batch.js";
import { applyChipPatina } from "./chip-patina.js";

import {
  CHIP_DENOMINATIONS,
  chipDenomination,
  chipStackForAmount,
} from "./chip-stack.js";
export {
  CHIP_DENOMINATIONS,
  chipDenomination,
  chipStackForAmount,
} from "./chip-stack.js";

/** Owns the shared model/texture GPU resources for one renderer or scene. */
export async function createChipFactory(
  renderer,
  { resolveAsset, loadModel, loadTexture } = {},
) {
  if (!resolveAsset) {
    const { assetURL } = await import("./asset-url.js");
    resolveAsset = assetURL;
  }
  const loader = new GLTFLoader();
  const textureLoader = new THREE.TextureLoader();
  loadModel ||= (url) => loader.loadAsync(url);
  loadTexture ||= (url) => textureLoader.loadAsync(url);
  const anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const textures = new Set(),
    materials = new Set(),
    geometries = new Set();
  let disposed = false;
  const disposeOwned = () => {
    if (disposed) return;
    disposed = true;
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) material.dispose();
    for (const texture of textures) texture.dispose();
  };
  const collectModel = (gltf) => {
    gltf.scene.traverse((object) => {
      if (!object.isMesh) return;
      geometries.add(object.geometry);
      for (const material of Array.isArray(object.material)
        ? object.material
        : [object.material]) {
        materials.add(material);
        for (const value of Object.values(material))
          if (value?.isTexture) {
            value.anisotropy = anisotropy;
            textures.add(value);
          }
      }
    });
    return gltf;
  };
  const loadData = async (name) => {
    const texture = await loadTexture(resolveAsset(name));
    texture.flipY = false;
    texture.colorSpace = THREE.NoColorSpace;
    texture.anisotropy = anisotropy;
    textures.add(texture);
    return texture;
  };
  // Wait for every request before rejecting, so a late successful model/map
  // cannot escape cleanup after another request fails.
  const loaded = await Promise.allSettled([
    loadModel(resolveAsset("chip-logo.glb")).then(collectModel),
    loadModel(resolveAsset("chip-logo-lod.glb"))
      .then(collectModel)
      .catch(() => null),
    ...[1, 2, 3].map((i) => loadData(`chip-normal-${i}.png`)),
    ...[1, 2, 3].map((i) => loadData(`chip-roughness-${i}.png`)),
    loadData("chip-patina.png"),
  ]);
  const failure = loaded.find((result) => result.status === "rejected");
  if (failure) {
    disposeOwned();
    throw failure.reason;
  }
  const [gltf, lowDetail, ...wearMaps] = loaded.map((result) => result.value);
  const normalMaps = wearMaps.slice(0, 3),
    roughnessMaps = wearMaps.slice(3, 6),
    patinaMap = wearMaps[6];
  patinaMap.wrapS = patinaMap.wrapT = THREE.RepeatWrapping;
  try {
    // GLTFLoader.loadTextureImage converts a failed image request to null,
    // allowing loadAsync to resolve. These maps must precede the startup gate.
    const detailedMaterials = new Map();
    gltf.scene.traverse((object) => {
      if (!object.isMesh) return;
      for (const m of Array.isArray(object.material)
        ? object.material
        : [object.material])
        detailedMaterials.set(m.name, m);
    });
    for (const [name, keys] of [
      ["ChipBase", ["map"]],
      ["ChipEngraving", ["map", "normalMap", "roughnessMap"]],
    ]) {
      const material = detailedMaterials.get(name);
      for (const key of keys)
        if (!material?.[key]?.isTexture)
          throw new Error(`Chip model is missing required ${name}.${key}`);
    }
  } catch (error) {
    disposeOwned();
    throw error;
  }
  const lowGeometry = new Map();
  lowDetail?.scene.traverse((object) => {
    if (!object.isMesh) return;
    lowGeometry.set(object.material.name, object.geometry);
  });
  const cache = new Map();
  function styled(original, denomination, wear, opacity = 1) {
    // Only the clay changes denomination; inlays share wear and metal/engraving
    // share one material across every chip. Avoid splitting identical GPU batches.
    const colored = original.name.startsWith("ChipBase");
    const worn = /^Chip(Base|Inlay)/.test(original.name);
    const key = `${original.uuid}/${colored ? denomination : 0}/${worn ? wear : 0}/${opacity}`;
    if (!cache.has(key)) {
      const material = original.clone();
      if (original.name.startsWith("ChipBase"))
        material.color.set(chipDenomination(denomination).color);
      if (/^Chip(Base|Inlay)/.test(original.name)) {
        material.normalMap = normalMaps[wear];
        const relief = [0.3, 0.38, 0.44][wear];
        material.normalScale.set(relief, relief);
        material.roughnessMap = roughnessMaps[wear];
        // The texture contains the final clay roughness; do not polish it by
        // multiplying it down a second time. Resin dice have a separate finish.
        material.roughness = 1;
        material.metalness = 0;
      }
      if (/^Chip(Base|Inlay|Engraving)/.test(original.name))
        applyChipPatina(
          material,
          patinaMap,
          original.name === "ChipEngraving" ? 0.42 : 1,
        );
      material.envMapIntensity = 0.75;
      if (opacity < 1) {
        material.transparent = true;
        material.opacity = opacity;
        material.depthWrite = false;
      }
      materials.add(material);
      cache.set(key, material);
    }
    return cache.get(key);
  }
  return {
    create({
      denomination = 500,
      wear = 0,
      diameter = 0.38,
      thicknessScale = 1.3,
      opacity = 1,
    } = {}) {
      wear = ((wear % 3) + 3) % 3;
      const group = gltf.scene.clone(true);
      group.scale.set(diameter, diameter * thicknessScale, diameter);
      group.userData.chip = {
        denomination,
        wear,
        diameter,
        height: 0.13 * diameter * thicknessScale,
      };
      group.traverse((object) => {
        if (!object.isMesh) return;
        object.castShadow = object.receiveShadow = true;
        object.material = Array.isArray(object.material)
          ? object.material.map((m) => styled(m, denomination, wear, opacity))
          : styled(object.material, denomination, wear, opacity);
      });
      return group;
    },
    createBatch(specs) {
      gltf.scene.updateMatrixWorld(true);
      const sources = [];
      gltf.scene.traverse((object) => {
        if (object.isMesh) sources.push(object);
      });
      return createChipBatch(specs, sources, styled, lowGeometry);
    },
    updateLOD(root, camera, height, detail = "auto") {
      let changed = false;
      root.traverse((object) => {
        const batch = object.userData.chipBatch;
        if (batch) changed = batch.update(camera, height, detail) || changed;
      });
      return changed;
    },
    dispose() {
      disposeOwned();
      cache.clear();
    },
  };
}

const thumbnailCache = new Map();

/** Transparent PNG data URLs rendered from the active logo chip, for native <img> controls. */
export function renderChipThumbnails(
  values = [500, 2500, 10000, 50000],
  { size = 160 } = {},
) {
  const key = `${values.join(",")}/${size}`;
  if (!thumbnailCache.has(key)) {
    const promise = (async () => {
      const renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true,
        preserveDrawingBuffer: true,
      });
      renderer.setSize(size, size);
      renderer.setPixelRatio(1);
      renderer.setClearColor(0x000000, 0);
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.15;
      const scene = new THREE.Scene();
      const camera = new THREE.OrthographicCamera(
        -0.83,
        0.83,
        0.83,
        -0.83,
        0.1,
        20,
      );
      camera.position.set(1.2, 1.8, 2.1);
      camera.lookAt(0, 0, 0);
      scene.add(new THREE.HemisphereLight(0xfff5df, 0x414755, 2.2));
      const keyLight = new THREE.DirectionalLight(0xfff3d8, 3.1);
      keyLight.position.set(-3, 5, 3);
      scene.add(keyLight);
      const rim = new THREE.DirectionalLight(0xc9d7f1, 1.2);
      rim.position.set(4, 1, -2);
      scene.add(rim);
      let factory;
      try {
        factory = await createChipFactory(renderer);
        const result = {};
        for (const [i, value] of values.entries()) {
          const chip = factory.create({
            denomination: value,
            wear: i % 3,
            diameter: 1.36,
            thicknessScale: 1.2,
          });
          chip.rotation.y = -0.12;
          scene.add(chip);
          renderer.render(scene, camera);
          result[value] = renderer.domElement.toDataURL("image/png");
          scene.remove(chip);
        }
        return result;
      } finally {
        factory?.dispose();
        renderer.dispose();
        renderer.forceContextLoss();
      }
    })();
    thumbnailCache.set(key, promise);
    promise.catch(() => thumbnailCache.delete(key));
  }
  return thumbnailCache.get(key);
}
