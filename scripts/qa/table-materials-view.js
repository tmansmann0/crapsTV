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
window.capture = (view) => {
  const views = {
    trays: [
      [3.6, 3.0, 5.9],
      [2.4, 0.45, 3],
    ],
    corner: [
      [8.9, 3.8, 5.7],
      [5.2, 0.25, 2.0],
    ],
    legs: [
      [7.7, 0.15, 6.8],
      [3.9, -0.9, 1.0],
    ],
    overview: [
      [12, 13, 14],
      [0, 0.1, 0.4],
    ],
  };
  const [p, t] = views[view];
  camera.position.fromArray(p);
  camera.lookAt(...t);
  renderer.render(scene, camera);
  return {
    calls: renderer.info.render.calls,
    triangles: renderer.info.render.triangles,
    materials: materials.textures.size,
    wood: {
      roughness: g.children.find(
        (o) => o.material?.name === "Hand-polished dark walnut",
      )?.material.roughness,
    },
  };
};
window.capture("trays");
window.ready = true;
