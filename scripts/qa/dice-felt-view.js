import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { EXRLoader } from "three/addons/loaders/EXRLoader.js";
import { createDiceMaterial } from "/src/dice-material.js";
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
scene.background = new THREE.Color("#10221b");
const camera = new THREE.PerspectiveCamera(35, 1.6, 0.005, 100);
const env = await new EXRLoader().loadAsync("/assets/casino-room.exr");
env.mapping = THREE.EquirectangularReflectionMapping;
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromEquirectangular(env).texture;
scene.add(new THREE.HemisphereLight(0xc6d9ce, 0x18251e, 0.38));
for (const [intensity, pos] of [
  [2.5, [-3, 8, 3]],
  [1.1, [6, 5, -4]],
]) {
  const l = new THREE.DirectionalLight(0xffe5c6, intensity);
  l.position.fromArray(pos);
  scene.add(l);
}
const tl = new THREE.TextureLoader();
async function load(name) {
  const t = await tl.loadAsync("/assets/" + name);
  t.flipY = false;
  t.colorSpace = THREE.NoColorSpace;
  return t;
}
const normal = await load("felt-normal.png"),
  rough = await load("felt-roughness.png");
for (const t of [normal, rough]) {
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(10.84 / 0.46, 5.4 / 0.46);
  t.anisotropy = 8;
}
const boardMap = await tl.loadAsync("/assets/board-classic.png");
boardMap.colorSpace = THREE.SRGBColorSpace;
let settings = { normalScale: new THREE.Vector2(0.26, 0.26) };
if (new URLSearchParams(location.search).has("after")) {
  const m = await import("/src/felt-surface.js");
  settings = m.createFeltSurfaceSettings();
}
const board = new THREE.Mesh(
  new THREE.PlaneGeometry(10.84, 5.4),
  new THREE.MeshPhysicalMaterial({
    map: boardMap,
    roughness: 1,
    normalMap: normal,
    roughnessMap: rough,
    ...settings,
  }),
);
board.rotation.x = -Math.PI / 2;
scene.add(board);
const model = (await new GLTFLoader().loadAsync("/assets/dice.glb")).scene;
const normals = await Promise.all(
  [1, 2, 3].map((i) => load(`dice-wear-${i}.png`)),
);
const after = new URLSearchParams(location.search).has("after");
const roughness = await Promise.all(
  [1, 2, 3].map((i) =>
    load(after ? `dice-roughness-${i}.png` : "dice-roughness.png"),
  ),
);
const dice = [];
for (let i = 0; i < 3; i++) {
  const d = model.clone(true);
  d.scale.setScalar(0.24);
  d.position.set((i - 1) * 0.31, 0.12, 0.1);
  d.rotation.y = i * 0.3;
  d.traverse((o) => {
    if (o.isMesh && o.material.name === "DiceBody")
      o.material = createDiceMaterial(
        { color: ["red", "green", "blue"][i], finish: "solid" },
        normals[i],
        roughness[i],
      );
  });
  scene.add(d);
  dice.push(d);
}
window.capture = (view) => {
  dice.forEach((d, i) => {
    d.visible = !view.startsWith("felt");
    d.traverse((o) => {
      if (!o.isMesh || o.material.name !== "DiceBody") return;
      o.material.dispose();
      o.material = createDiceMaterial(
        {
          color: ["red", "green", "blue"][i],
          finish: view.startsWith("translucent") ? "translucent" : "solid",
        },
        normals[i],
        roughness[i],
      );
    });
  });
  const views = {
    "translucent-close": [
      [0.36, 0.46, 0.75],
      [0, 0.12, 0.1],
    ],
    "dice-close": [
      [0.36, 0.46, 0.75],
      [0, 0.12, 0.1],
    ],
    "dice-raking": [
      [0.62, 0.19, 0.65],
      [0, 0.12, 0.1],
    ],
    "felt-close": [
      [0.3, 0.28, 0.55],
      [0, 0, 0],
    ],
    "felt-raking": [
      [0.5, 0.085, 0.46],
      [0, 0, 0],
    ],
  };
  const [p, t] = views[view];
  camera.position.fromArray(p);
  camera.lookAt(...t);
  renderer.render(scene, camera);
  return {
    calls: renderer.info.render.calls,
    triangles: renderer.info.render.triangles,
  };
};
window.capture("dice-close");
window.ready = true;
