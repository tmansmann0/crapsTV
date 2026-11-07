import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { EXRLoader } from "three/addons/loaders/EXRLoader.js";
import { createTableMaterials } from "/src/table-materials.js";
import { createChipFactory } from "/src/chip-rendering.js";
import { createBoardMaterial } from "/src/board-material.js";
import { createDiceMaterial } from "/src/dice-material.js";
import {
  createFeltStudy,
  createFeltFuzzLayer,
  FELT_STUDIES,
} from "/src/felt-study.js";
import { stripBoardHatch } from "/src/board-hatch.js";

const asset = (name) => "/assets/" + name;
const renderer = new THREE.WebGLRenderer({
  antialias: true,
  preserveDrawingBuffer: true,
});
renderer.setPixelRatio(1);
renderer.setSize(3840, 2160);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.9;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.style.cssText = "margin:0;background:#111a14";
renderer.domElement.style.cssText =
  "width:100vw;height:100vh;object-fit:contain;display:block";
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color("#15251a");
const camera = new THREE.PerspectiveCamera(43, 16 / 9, 0.015, 160);
const env = await new EXRLoader().loadAsync(asset("casino-room.exr"));
env.mapping = THREE.EquirectangularReflectionMapping;
const pmrem = new THREE.PMREMGenerator(renderer),
  envTarget = pmrem.fromEquirectangular(env);
scene.environment = envTarget.texture;
scene.environmentIntensity = 1.2;
scene.environmentRotation.y = Math.PI / 2;
scene.add(new THREE.HemisphereLight(0xc6d9ce, 0x18251e, 0.38));
const key = new THREE.DirectionalLight(0xffe5c6, 2.5);
key.position.set(-4, 10, 4);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.normalBias = 0.02;
key.shadow.bias = -0.0002;
Object.assign(key.shadow.camera, {
  left: -9,
  right: 9,
  top: 7,
  bottom: -7,
  near: 1,
  far: 30,
});
scene.add(key);
const rim = new THREE.DirectionalLight(0xf3d4a3, 1.1);
rim.position.set(7, 4, -7);
scene.add(rim);
const loader = new GLTFLoader(),
  tl = new THREE.TextureLoader();
const [model, tableMaterials, factory, atlas] = await Promise.all([
  loader.loadAsync(asset("table-player-rails-optimized.glb")),
  createTableMaterials(renderer, { resolveAsset: asset }),
  createChipFactory(renderer, { resolveAsset: asset }),
  tl.loadAsync(asset("felt-studies/wool-fibres.png")),
]);
tableMaterials.apply(model.scene);
model.scene.traverse((o) => {
  if (o.isMesh) o.castShadow = o.receiveShadow = true;
});
scene.add(model.scene);
atlas.colorSpace = THREE.NoColorSpace;
atlas.flipY = false;
atlas.wrapS = atlas.wrapT = THREE.RepeatWrapping;
atlas.anisotropy = 8;
const originalSVG = await fetch(asset("board-classic.svg")).then((r) =>
  r.text(),
);
const stripped = stripBoardHatch(originalSVG);
const svg = stripped.svg.replace(
  /width="2048" height="1024"/,
  'width="8192" height="4096"',
);
const blobURL = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
const image = new Image();
image.src = blobURL;
await image.decode();
const print = new THREE.Texture(image);
print.colorSpace = THREE.SRGBColorSpace;
print.anisotropy = 16;
print.needsUpdate = true;
const board = new THREE.Mesh(
  new THREE.PlaneGeometry(10.84, 5.4),
  createBoardMaterial({ surfaceProfile: false }),
);
board.rotation.x = -Math.PI / 2;
board.position.y = 0.012;
board.receiveShadow = true;
board.material.map = print;
scene.add(board);
const felt = createFeltStudy(board.material, atlas);
const fuzz = createFeltFuzzLayer(print);
scene.add(fuzz.mesh);
const chips = factory.createBatch([
  ...Array.from({ length: 5 }, (_, i) => ({
    id: `felt-chip-${i}`,
    denomination: 500,
    wear: i % 3,
    diameter: 0.27,
    thicknessScale: 1.3,
    position: [0.35, 0.012 + 0.0279 + i * 0.046, 1.19],
    rotation: [0, 0.17 * i, 0],
  })),
  {
    id: "felt-loose",
    denomination: 2500,
    wear: 2,
    diameter: 0.27,
    thicknessScale: 1.3,
    position: [-0.42, 0.036, 1.42],
    rotation: [0, 0.43, 0],
  },
  ...Array.from({ length: 16 }, (_, i) => ({
    id: `felt-bank-${i}`,
    denomination: 10000,
    wear: i % 3,
    diameter: 0.23,
    thicknessScale: 1.3,
    position: [-0.8, 0.67 + 0.0194 + i * 0.0389, 3.93],
    rotation: [0, 0.12 * i, 0],
  })),
]);
scene.add(chips);
const die = (await loader.loadAsync(asset("dice.glb"))).scene;
const [dn, dr] = await Promise.all([
  tl.loadAsync(asset("dice-wear-1.png")),
  tl.loadAsync(asset("dice-roughness-1.png")),
]);
for (const t of [dn, dr]) {
  t.colorSpace = THREE.NoColorSpace;
  t.flipY = false;
}
die.scale.setScalar(0.22);
die.position.set(-0.15, 0.11, 0.74);
die.rotation.y = 0.32;
die.traverse((o) => {
  if (o.isMesh) {
    o.castShadow = o.receiveShadow = true;
    if (o.material.name === "DiceBody")
      o.material = createDiceMaterial(
        { color: "blue", finish: "solid" },
        dn,
        dr,
      );
  }
});
scene.add(die);
const views = {
  hero: {
    position: [-0.12, 0.26, 1.92],
    target: [-0.05, 0.035, 1.29],
    fov: 43,
  },
  wide: { position: [-0.5, 3.8, 6.2], target: [-0.25, 0.2, 1.1], fov: 42 },
};
window.feltStudy = {
  ready: true,
  options: FELT_STUDIES,
  render(id = "fine", shot = "hero") {
    felt.apply(id);
    const v = views[shot];
    camera.position.fromArray(v.position);
    camera.lookAt(...v.target);
    camera.fov = v.fov;
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    fuzz.apply(id, camera);
    factory.updateLOD(chips, camera, 2160, "auto");
    renderer.info.reset();
    renderer.render(scene, camera);
    return {
      id,
      shot,
      settings: FELT_STUDIES[id],
      camera: v,
      width: renderer.domElement.width,
      height: renderer.domElement.height,
      calls: renderer.info.render.calls,
      triangles: renderer.info.render.triangles,
      hatchPathsRemoved: stripped.removed,
      geometryAdded: fuzz.triangles,
      fuzzTriangles: fuzz.triangles,
      atlasBytes: 1024 * 1024 * 4,
    };
  },
  image() {
    return renderer.domElement.toDataURL("image/jpeg", 0.94);
  },
  dispose() {
    felt.dispose();
    fuzz.dispose();
    factory.dispose();
    tableMaterials.dispose();
    atlas.dispose();
    print.dispose();
    URL.revokeObjectURL(blobURL);
    env.dispose();
    envTarget.dispose();
    pmrem.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
  },
};
window.feltStudy.render();
