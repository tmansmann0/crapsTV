import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { EXRLoader } from "three/addons/loaders/EXRLoader.js";
import { createLocalReflections } from "/src/local-reflections.js";
import { createTableMaterials } from "/src/table-materials.js";
import { createChipFactory } from "/src/chip-rendering.js";
import { createBoardMaterial } from "/src/board-material.js";
import { createBoardArtwork } from "/src/board-artwork.js";
import { createDiceMaterial } from "/src/dice-material.js";
const asset = (n) => "/assets/" + n;
const renderer = new THREE.WebGLRenderer({
  antialias: true,
  preserveDrawingBuffer: true,
});
renderer.setPixelRatio(1);
renderer.setSize(1920, 1080);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.9;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.shadowMap.autoUpdate = false;
renderer.shadowMap.needsUpdate = true;
document.body.style.margin = "0";
renderer.domElement.style.cssText = "width:100vw;height:100vh;display:block";
document.body.append(renderer.domElement);
const scene = new THREE.Scene(),
  camera = new THREE.PerspectiveCamera(40, 16 / 9, 0.035, 160);
camera.position.set(-1.8, 2.8, 6.4);
camera.lookAt(-0.1, 0.3, 2.4);
const hdr = await new EXRLoader().loadAsync(asset("casino-room.exr"));
hdr.mapping = THREE.EquirectangularReflectionMapping;
const pmrem = new THREE.PMREMGenerator(renderer),
  env = pmrem.fromEquirectangular(hdr);
scene.environment = env.texture;
scene.environmentRotation.y = Math.PI / 2;
const shell = new THREE.Mesh(
  new THREE.SphereGeometry(42, 64, 32),
  new THREE.MeshBasicMaterial({
    map: hdr,
    side: THREE.BackSide,
    color: 0xd4d4d4,
  }),
);
shell.rotation.y = Math.PI / 2;
shell.position.y = 2.2;
scene.add(shell);
scene.add(new THREE.HemisphereLight(0xc6d9ce, 0x18251e, 0.38));
const key = new THREE.DirectionalLight(0xffe5c6, 2.5);
key.position.set(-4, 10, 4);
key.castShadow = true;
Object.assign(key.shadow.camera, {
  left: -9,
  right: 9,
  top: 7,
  bottom: -7,
  near: 1,
  far: 30,
});
key.shadow.mapSize.set(1024, 1024);
key.shadow.bias = -0.0002;
key.shadow.normalBias = 0.02;
scene.add(key);
const rim = new THREE.DirectionalLight(0xf3d4a3, 1.1);
rim.position.set(7, 4, -7);
scene.add(rim);
const loader = new GLTFLoader(),
  tl = new THREE.TextureLoader();
const [table, materials, factory, diceModel, wool] = await Promise.all([
  loader.loadAsync(asset("table-player-rails-optimized.glb")),
  createTableMaterials(renderer, { resolveAsset: asset }),
  createChipFactory(renderer, { resolveAsset: asset }),
  loader.loadAsync(asset("dice.glb")),
  tl.loadAsync(asset("felt-studies/wool-fibres.png")),
]);
materials.apply(table.scene);
table.scene.traverse((o) => {
  if (o.isMesh) o.castShadow = o.receiveShadow = true;
});
scene.add(table.scene);
wool.colorSpace = THREE.NoColorSpace;
wool.flipY = false;
wool.wrapS = wool.wrapT = THREE.RepeatWrapping;
const board = new THREE.Mesh(
  new THREE.PlaneGeometry(10.84, 5.4),
  createBoardMaterial({ normalMap: wool }),
);
board.rotation.x = -Math.PI / 2;
board.position.y = 0.012;
board.receiveShadow = true;
scene.add(board);
const artwork = createBoardArtwork(renderer, { board, resolveAsset: asset });
await artwork.ready;
const specs = [];
for (let pile = 0; pile < 4; pile++)
  for (let i = 0; i < 14; i++)
    specs.push({
      id: `proof-${pile}-${i}`,
      denomination: [500, 2500, 10000, 100000][pile],
      wear: i % 3,
      diameter: 0.28,
      position: [-0.6 + pile * 0.4, 0.012 + i * 0.048, 1.9],
      rotation: [0, i * 0.17, 0],
    });
scene.add(factory.createBatch(specs));
const ghost = factory.createBatch([
  {
    id: "ghost",
    denomination: 500,
    diameter: 0.4,
    opacity: 0.4,
    position: [1.2, 0.4, 1.6],
  },
]);
scene.add(ghost);
function makeDie(color = "blue") {
  const die = diceModel.scene.clone(true);
  die.scale.setScalar(0.24);
  die.position.set(0.35, 0.12, 1.2);
  die.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = o.receiveShadow = true;
      if (o.material.name === "DiceBody")
        o.material = createDiceMaterial({ color, finish: "solid" }, null, null);
    }
  });
  return die;
}
scene.add(makeDie());
const local = createLocalReflections(renderer, { scene, board, artwork });
let now = 0;
const measurements = [];
function draw() {
  artwork.render(camera, { width: 1920, height: 1080 });
  renderer.setRenderTarget(null);
  renderer.setViewport(0, 0, 1920, 1080);
  renderer.setScissorTest(false);
  renderer.render(scene, camera);
  renderer.getContext().finish();
}
draw();
draw();
function snapshot() {
  return {
    image: renderer.domElement.toDataURL("image/png"),
    textures: renderer.info.memory.textures,
    geometries: renderer.info.memory.geometries,
    ...local.metrics,
  };
}
function step(time, revision = 1, safe = true) {
  now = time;
  const target = renderer.getRenderTarget(),
    viewport = renderer.getViewport(new THREE.Vector4()).toArray(),
    before = artwork.metrics.draws,
    boardMaterial = board.material,
    hook = board.onBeforeRender,
    shadow = renderer.shadowMap.needsUpdate;
  const started = performance.now();
  const metrics = local.update(camera, { time, revision, safe });
  renderer.getContext().finish();
  const duration = performance.now() - started;
  if (
    board.material !== boardMaterial ||
    board.onBeforeRender !== hook ||
    renderer.getRenderTarget() !== target ||
    JSON.stringify(renderer.getViewport(new THREE.Vector4()).toArray()) !==
      JSON.stringify(viewport) ||
    renderer.shadowMap.needsUpdate !== shadow ||
    artwork.metrics.draws !== before
  )
    throw Error("reflection update leaked renderer/board state");
  measurements.push({
    time,
    revision,
    safe,
    duration,
    state: metrics.state,
    faces: metrics.faces,
  });
  draw();
  return metrics;
}
window.localReflectionProof = {
  ready: true,
  async exercise() {
    const off = snapshot();
    local.setEnabled(true);
    step(0);
    step(599);
    step(600);
    step(620);
    const cancelled = step(640, 1, false);
    step(1000);
    for (let i = 0; i < 6; i++) {
      step(1600 + i * 20);
      await new Promise(requestAnimationFrame);
    }
    const on = snapshot();
    const stable = step(5000);
    step(5100, 2);
    for (let i = 0; i < 6; i++) {
      step(5700 + i * 20, 2);
      await new Promise(requestAnimationFrame);
    }
    const warm = snapshot();
    local.setEnabled(false);
    draw();
    draw();
    const restored = snapshot();
    return { off, on, warm, restored, cancelled, stable, measurements };
  },
  late() {
    local.setEnabled(true);
    step(now + 100);
    for (let i = 0; i < 6; i++) step(now + 620);
    const die = makeDie("red");
    die.position.x = -1;
    scene.add(die);
    const registered = local.register(die);
    let assigned = false;
    die.traverse((o) => {
      if (o.material?.name === "DiceBody") assigned = !!o.material.envMap;
    });
    local.setEnabled(false);
    let reset = false;
    die.traverse((o) => {
      if (o.material?.name === "DiceBody") reset = o.material.envMap === null;
    });
    draw();
    return { registered, assigned, reset, off: local.metrics };
  },
  dispose() {
    local.dispose();
    artwork.dispose();
    factory.dispose();
    materials.dispose();
    env.dispose();
    pmrem.dispose();
    hdr.dispose();
    wool.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
  },
};
