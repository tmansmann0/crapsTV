import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

export const CHIP_DENOMINATIONS = [
  { value: 100, color: "#eee8dc", label: "$1" },
  { value: 500, color: "#a9112e", label: "$5" },
  { value: 2500, color: "#087342", label: "$25" },
  { value: 10000, color: "#111722", label: "$100" },
  { value: 50000, color: "#6d36a5", label: "$500" },
  { value: 100000, color: "#c28b0c", label: "$1,000" },
];

export function chipDenomination(value) {
  return (
    [...CHIP_DENOMINATIONS].reverse().find((d) => value >= d.value) ||
    CHIP_DENOMINATIONS[0]
  );
}

// A finite display stack, with its exact total shown separately by the caller.
export function chipStackForAmount(amount, limit = 8) {
  let remainder = Math.max(0, amount);
  const chips = [];
  for (const { value } of [...CHIP_DENOMINATIONS].reverse()) {
    while (remainder >= value && chips.length < limit) {
      chips.push(value);
      remainder -= value;
    }
  }
  if (!chips.length && amount > 0) chips.push(100);
  return { chips, truncated: remainder > 0, total: amount };
}

import { assetURL as asset } from "./asset-url.js";

/** Owns the shared model/texture GPU resources for one renderer or scene. */
export async function createChipFactory(renderer) {
  const loader = new GLTFLoader();
  const textureLoader = new THREE.TextureLoader();
  const anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const textures = new Set(),
    materials = new Set(),
    geometries = new Set();
  const loadData = async (name) => {
    const texture = await textureLoader.loadAsync(asset(name));
    texture.flipY = false;
    texture.colorSpace = THREE.NoColorSpace;
    texture.anisotropy = anisotropy;
    textures.add(texture);
    return texture;
  };
  const [gltf, lowDetail, normalMaps, roughnessMaps] = await Promise.all([
    loader.loadAsync(asset("chip.glb")),
    loader.loadAsync(asset("chip-lod.glb")).catch(() => null),
    Promise.all([1, 2, 3].map((i) => loadData(`chip-normal-${i}.png`))),
    Promise.all([1, 2, 3].map((i) => loadData(`chip-roughness-${i}.png`))),
  ]);
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
  const lowGeometry = new Map();
  lowDetail?.scene.traverse((object) => {
    if (!object.isMesh) return;
    geometries.add(object.geometry);
    lowGeometry.set(object.material.name, object.geometry);
    materials.add(object.material);
    for (const value of Object.values(object.material))
      if (value?.isTexture) textures.add(value);
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
        material.normalScale.set(0.48, 0.48);
        material.roughnessMap = roughnessMaps[wear];
        material.roughness = 0.78;
      }
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
      const group = new THREE.Group(),
        buckets = new Map();
      gltf.scene.updateMatrixWorld(true);
      const sourceMeshes = [];
      gltf.scene.traverse((object) => {
        if (object.isMesh) sourceMeshes.push(object);
      });
      const position = new THREE.Vector3(),
        quaternion = new THREE.Quaternion(),
        scale = new THREE.Vector3();
      for (const spec of specs) {
        const denomination = spec.denomination ?? 500,
          wear = (((spec.wear || 0) % 3) + 3) % 3;
        const diameter = spec.diameter ?? 0.23,
          thickness = spec.thicknessScale ?? 1.15;
        position.fromArray(spec.position || [0, 0, 0]);
        quaternion.setFromEuler(
          new THREE.Euler(...(spec.rotation || [0, 0, 0])),
        );
        scale.set(diameter, diameter * thickness, diameter);
        const transform = new THREE.Matrix4().compose(
          position,
          quaternion,
          scale,
        );
        for (const mesh of sourceMeshes) {
          const material = styled(
            mesh.material,
            denomination,
            wear,
            spec.opacity ?? 1,
          );
          const key = `${mesh.geometry.uuid}/${material.uuid}`;
          if (!buckets.has(key))
            buckets.set(key, {
              mesh,
              material,
              matrices: [],
            });
          buckets
            .get(key)
            .matrices.push(transform.clone().multiply(mesh.matrixWorld));
        }
      }
      for (const { mesh, material, matrices } of buckets.values()) {
        const batch = new THREE.InstancedMesh(
          mesh.geometry,
          material,
          matrices.length,
        );
        matrices.forEach((matrix, index) => batch.setMatrixAt(index, matrix));
        batch.castShadow = batch.receiveShadow = !material.transparent;
        batch.instanceMatrix.needsUpdate = true;
        batch.computeBoundingSphere();
        const low = lowGeometry.get(mesh.material.name);
        if (low)
          batch.userData.chipLOD = {
            high: mesh.geometry,
            low,
            diameter: Math.max(...specs.map((s) => s.diameter ?? 0.23)),
            detailed: true,
          };
        group.add(batch);
      }
      group.userData.chipCount = specs.length;
      return group;
    },
    updateLOD(root, camera, height, detail = "auto") {
      let changed = false;
      root.updateWorldMatrix(true, true);
      const center = new THREE.Vector3();
      const projectionScale =
        height / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
      root.traverse((object) => {
        const lod = object.userData.chipLOD;
        if (!lod) return;
        center
          .copy(object.boundingSphere.center)
          .applyMatrix4(object.matrixWorld);
        const pixels =
          (lod.diameter * projectionScale) /
          Math.max(0.1, center.distanceTo(camera.position));
        const detailed =
          detail === "full"
            ? true
            : detail === "optimized"
              ? false
              : lod.detailed
                ? pixels >= 28
                : pixels > 36;
        if (detailed !== lod.detailed) {
          lod.detailed = detailed;
          object.geometry = detailed ? lod.high : lod.low;
          changed = true;
        }
      });
      return changed;
    },
    dispose() {
      for (const geometry of geometries) geometry.dispose();
      for (const material of materials) material.dispose();
      for (const texture of textures) texture.dispose();
      cache.clear();
    },
  };
}

const thumbnailCache = new Map();

/** Transparent PNG data URLs rendered from chip.glb, for native <img> controls. */
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
