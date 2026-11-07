import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { EXRLoader } from "three/addons/loaders/EXRLoader.js";
import { createTableMaterials } from "/src/table-materials.js";
const renderer = new THREE.WebGLRenderer({
  antialias: true,
  preserveDrawingBuffer: true,
});
renderer.setSize(1600, 1000);
renderer.setPixelRatio(1);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.9;
document.body.style.margin = "0";
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color("#18201c");
const camera = new THREE.PerspectiveCamera(40, 1.6, 0.035, 100);
const env = await new EXRLoader().loadAsync("/assets/casino-room.exr");
env.mapping = THREE.EquirectangularReflectionMapping;
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromEquirectangular(env).texture;
scene.add(new THREE.HemisphereLight(0xc6d9ce, 0x18251e, 0.38));
for (const [color, intensity, pos] of [
  [0xffe5c6, 2.5, [-3, 8, 3]],
  [0xf3d4a3, 1.1, [6, 5, -4]],
]) {
  const l = new THREE.DirectionalLight(color, intensity);
  l.position.fromArray(pos);
  scene.add(l);
}
const g = (
  await new GLTFLoader().loadAsync("/assets/table-player-rails-optimized.glb")
).scene;
const materials = await createTableMaterials(renderer, {
  resolveAsset: (n) => "/assets/" + n,
});
materials.apply(g);
scene.add(g);
const boardTexture = await new THREE.TextureLoader().loadAsync(
  "/assets/board-classic.png",
);
boardTexture.colorSpace = THREE.SRGBColorSpace;
const board = new THREE.Mesh(
  new THREE.PlaneGeometry(10.84, 5.4),
  new THREE.MeshStandardMaterial({ map: boardTexture, roughness: 0.98 }),
);
board.rotation.x = -Math.PI / 2;
board.position.y = 0.012;
scene.add(board);
const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(60, 60),
  new THREE.MeshStandardMaterial({ color: "#17231e", roughness: 0.9 }),
);
floor.rotation.x = -Math.PI / 2;
floor.position.y = -2.5;
scene.add(floor);
const woodMeshes = [];
g.traverse((o) => {
  if (o.isMesh && o.material.name === "Hand-polished dark walnut") {
    woodMeshes.push(o);
    o.userData.physical = o.material;
    o.userData.originalNormal = o.material.normalMap;
    o.userData.unlit = new THREE.MeshBasicMaterial({ map: o.material.map });
  }
});
window.capture = (view, mode = "pbr") => {
  const views = {
    frontRight: [
      [8.4, 2.2, 6.0],
      [5.7, 0.5, 3.3],
    ],
    frontLeft: [
      [-8.4, 2.2, 6.0],
      [-5.7, 0.5, 3.3],
    ],
    backRight: [
      [8.4, 2.2, -5.2],
      [5.7, 0.5, -2.5],
    ],
    backLeft: [
      [-8.4, 2.2, -5.2],
      [-5.7, 0.5, -2.5],
    ],
    grazing: [
      [7.8, 1.15, 5.1],
      [5.7, 0.48, 3.35],
    ],
    shelf: [
      [7.4, 2.8, 5.25],
      [5.75, 0.6, 3.4],
    ],
  };
  for (const o of woodMeshes) {
    o.material = mode === "unlit" ? o.userData.unlit : o.userData.physical;
    if (mode !== "unlit") {
      o.material.normalMap =
        mode === "no-normal" ? null : o.userData.originalNormal;
      o.material.needsUpdate = true;
    }
  }
  const [p, t] = views[view];
  camera.position.fromArray(p);
  camera.lookAt(...t);
  renderer.render(scene, camera);
  return {
    calls: renderer.info.render.calls,
    triangles: renderer.info.render.triangles,
    position: p,
    target: t,
    mode,
  };
};
window.capture("frontRight");
window.ready = true;
