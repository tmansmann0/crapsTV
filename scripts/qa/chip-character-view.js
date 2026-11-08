import * as THREE from "three";
import { EXRLoader } from "three/addons/loaders/EXRLoader.js";
import { createChipFactory } from "/src/chip-rendering.js";
import { chipStackPose, chipStackBounds } from "/src/chip-character.js";
const renderer = new THREE.WebGLRenderer({
  antialias: true,
  preserveDrawingBuffer: true,
});
renderer.setSize(1600, 1000);
renderer.setPixelRatio(1);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;
document.body.style.margin = "0";
document.body.append(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color("#13241d");
const env = await new EXRLoader().loadAsync("/assets/casino-room.exr");
env.mapping = THREE.EquirectangularReflectionMapping;
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromEquirectangular(env).texture;
scene.environmentIntensity = 0.7;
const hemi = new THREE.HemisphereLight(0xfff3df, 0x24352b, 1.1);
scene.add(hemi);
const key = new THREE.DirectionalLight(0xffe9c9, 3.2);
key.position.set(-3, 3, 2);
scene.add(key);
const rim = new THREE.DirectionalLight(0xd1e3ff, 1.3);
rim.position.set(4, 2, -3);
scene.add(rim);
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(30, 30),
  new THREE.MeshStandardMaterial({ color: "#113c29", roughness: 0.96 }),
);
ground.rotation.x = -Math.PI / 2;
ground.position.y = -0.004;
scene.add(ground);
const camera = new THREE.PerspectiveCamera(35, 1.6, 0.02, 50);
const factory = await createChipFactory(renderer);
const specs = [];
for (const [slot, denomination, count, x, z] of [
  [0, 500, 8, -0.66, 0],
  [1, 2500, 4, 0, 0],
  [2, 10000, 6, 0.66, 0],
  [3, 100, 1, -0.42, 0.63],
  [4, 50000, 2, 0.22, 0.61],
  [5, 100000, 1, 0.75, 0.61],
])
  for (let n = 0; n < count; n++) {
    const pose = chipStackPose(`character:${slot}`, n, {
      diameter: 0.38,
      thicknessScale: 1.3,
    });
    specs.push({
      id: `character:${slot}:${n}`,
      denomination,
      wear: (slot + n) % 3,
      diameter: 0.38,
      thicknessScale: 1.3,
      position: pose.position.map(
        (v, i) => v + (i === 0 ? x : i === 2 ? z : 0),
      ),
      rotation: pose.rotation,
    });
  }
const batch = factory.createBatch(specs);
scene.add(batch);
const uniforms = new Map();
batch.traverse((o) => {
  if (!o.isMesh || !o.material.userData.chipPatina) return;
  const m = o.material;
  if (uniforms.has(m)) return;
  uniforms.set(m, null);
  const prior = m.onBeforeCompile;
  m.onBeforeCompile = (shader, r) => {
    prior(shader, r);
    uniforms.set(m, {
      uniform: shader.uniforms.chipPatinaStrength,
      original: shader.uniforms.chipPatinaStrength.value,
    });
  };
});
const bounds = chipStackBounds(specs);
window.capture = async (view) => {
  const low = view === "raking" || view === "clean";
  hemi.intensity = low ? 0.35 : 1.1;
  rim.intensity = low ? 0.45 : 1.3;
  scene.environmentIntensity = low ? 0.4 : 0.7;
  key.position.set(...(low ? [-3, 0.8, 1] : [-3, 3, 2]));
  if (view === "top") {
    camera.position.set(0.15, 2.2, 1.15);
    camera.lookAt(0, 0.19, 0.15);
  } else if (view === "macro") {
    camera.position.set(-0.89, 0.98, 0.9);
    camera.lookAt(-0.61, 0.39, 0);
  } else {
    camera.position.set(0.9, 0.74, 1.75);
    camera.lookAt(0, 0.23, 0.12);
  }
  camera.updateMatrixWorld(true);
  factory.updateLOD(batch, camera, 1000, "full");
  renderer.render(scene, camera);
  for (const value of uniforms.values())
    if (value) value.uniform.value = view === "clean" ? 0 : value.original;
  renderer.render(scene, camera);
  return {
    draws: renderer.info.render.calls,
    triangles: renderer.info.render.triangles,
    instances: specs.length,
    bounds,
    materialCount: uniforms.size,
  };
};
await window.capture("raking");
window.ready = true;
