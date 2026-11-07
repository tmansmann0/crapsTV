import * as THREE from "three";
import { EXRLoader } from "three/addons/loaders/EXRLoader.js";
import { createChipFactory } from "/src/chip-rendering.js";
const renderer = new THREE.WebGLRenderer({
  antialias: true,
  preserveDrawingBuffer: true,
});
renderer.setSize(1600, 1200);
renderer.setPixelRatio(1);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
document.body.style.margin = "0";
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color("#16231d");
const env = await new EXRLoader().loadAsync("/assets/casino-room.exr");
env.mapping = THREE.EquirectangularReflectionMapping;
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromEquirectangular(env).texture;
scene.add(new THREE.HemisphereLight(0xfff1d5, 0x2b3b37, 1.3));
const light = new THREE.DirectionalLight(0xffefd4, 3.1);
light.position.set(-3, 5, 2);
scene.add(light);
const rim = new THREE.DirectionalLight(0xd6e5ff, 1.2);
rim.position.set(4, 2, -3);
scene.add(rim);
const camera = new THREE.OrthographicCamera(-1.8, 1.8, 1.35, -1.35, 0.035, 50);
const factory = await createChipFactory(renderer);
const chips = [];
for (const [index, [x, z, low, back]] of [
  [-0.66, -0.66, false, false],
  [0.66, -0.66, true, false],
  [-0.66, 0.66, false, true],
  [0.66, 0.66, true, true],
].entries()) {
  const spec = {
    denomination: 500,
    wear: index % 3,
    diameter: 1.12,
    thicknessScale: 1.15,
    rotation: [back ? Math.PI : 0, 0, 0],
    position: [x, 0, z],
  };
  let chip;
  if (low) {
    chip = factory.createBatch([spec]);
  } else {
    chip = factory.create(spec);
    chip.position.set(x, 0, z);
    chip.rotation.x = spec.rotation[0];
  }
  scene.add(chip);
  chips.push(chip);
}
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(100, 100),
  new THREE.MeshStandardMaterial({ color: "#16291f", roughness: 0.95 }),
);
ground.rotation.x = -Math.PI / 2;
ground.position.y = -0.1;
scene.add(ground);
window.capture = (view) => {
  const close = view.startsWith("raking");
  camera.left = close ? -0.85 : -1.8;
  camera.right = -camera.left;
  camera.top = close ? 0.6375 : 1.35;
  camera.bottom = -camera.top;
  camera.updateProjectionMatrix();
  chips.forEach((chip, i) => (chip.visible = !close || i === 0));
  const hemisphere = scene.children.find((o) => o.isHemisphereLight);
  hemisphere.intensity = close ? 0.15 : 1.3;
  rim.intensity = close ? 0.15 : 1.2;
  light.intensity = close ? 4 : 3.1;
  light.position.set(...(close ? [-3, 0.6, -0.3] : [-3, 5, 2]));
  scene.environmentIntensity = close ? 0.25 : 1;
  chips[0].traverse((o) => {
    if (o.isMesh && o.material.name === "ChipEngraving")
      o.material.normalScale.set(
        view === "raking-flat" ? 0 : 1,
        view === "raking-flat" ? 0 : -1,
      );
  });
  camera.up.set(0, 0, -1);
  if (view === "faces") {
    camera.position.set(0, 6, 0);
    camera.lookAt(0, 0, 0);
  } else if (close) {
    camera.up.set(0, 1, 0);
    camera.position.set(-0.66, 1.4, 0.8);
    camera.lookAt(-0.66, 0, -0.66);
  } else {
    camera.up.set(0, 1, 0);
    camera.position.set(1.8, 3.4, 3.9);
    camera.lookAt(0, 0, 0);
  }
  camera.updateMatrixWorld(true);
  for (const chip of chips) factory.updateLOD(chip, camera, 1200, "optimized");
  renderer.render(scene, camera);
  return {
    draws: renderer.info.render.calls,
    triangles: renderer.info.render.triangles,
  };
};
window.capture("faces");
window.ready = true;
