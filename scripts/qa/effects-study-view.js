// Matched captures of real production assets and effects. No gameplay imports it.
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { EXRLoader } from "three/addons/loaders/EXRLoader.js";
import { createTableMaterials } from "/src/table-materials.js";
import { createChipFactory } from "/src/chip-rendering.js";
import { chipStackPose } from "/src/chip-character.js";
import { createDiceMaterial } from "/src/dice-material.js";
import { createBoardMaterial } from "/src/board-material.js";
import { createBoardArtwork } from "/src/board-artwork.js";
import { createLocalReflections } from "/src/local-reflections.js";
import { createContactShadows } from "/src/contact-shadows.js";
import { createLensFlares, findPanoramaFlareSources } from "/src/lens-flare.js";

const width = 3840,
  height = 2160;
const asset = (name) => "/assets/" + name;
const renderer = new THREE.WebGLRenderer({
  antialias: true,
  preserveDrawingBuffer: true,
});
renderer.setPixelRatio(1);
renderer.setSize(width, height);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.9;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.shadowMap.autoUpdate = false;
document.body.style.margin = "0";
renderer.domElement.style.cssText = "width:100vw;height:100vh;display:block";
document.body.append(renderer.domElement);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(54, width / height, 0.02, 160);
const hdr = await new EXRLoader().loadAsync(asset("casino-room.exr"));
hdr.mapping = THREE.EquirectangularReflectionMapping;
const pmrem = new THREE.PMREMGenerator(renderer);
const environment = pmrem.fromEquirectangular(hdr);
scene.environment = environment.texture;
scene.environmentRotation.y = Math.PI / 2;
const shell = new THREE.Mesh(
  new THREE.SphereGeometry(42, 96, 64),
  new THREE.MeshBasicMaterial({
    map: hdr,
    side: THREE.BackSide,
    color: 0xd4d4d4,
  }),
);
shell.position.y = 2.2;
shell.rotation.y = Math.PI / 2;
shell.userData.environment = true;
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
key.shadow.mapSize.set(2048, 2048);
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
const props = new THREE.Group();
scene.add(props);
const specs = [];
for (const [pile, [x, z, count, denomination]] of [
  [-0.18, 3.94, 9, 500],
  [0.18, 3.86, 6, 2500],
  [0.45, 3.67, 3, 10000],
  [-0.02, 4.22, 1, 100000],
].entries())
  for (let i = 0; i < count; i++) {
    const pose = chipStackPose(`effects-${pile}`, i, {
      diameter: 0.28,
      thicknessScale: 1.3,
    });
    specs.push({
      id: `effects-${pile}-${i}`,
      denomination,
      wear: i % 3,
      diameter: 0.28,
      thicknessScale: 1.3,
      position: [
        x + pose.position[0],
        0.615 + pose.position[1],
        z + pose.position[2],
      ],
      rotation: pose.rotation,
    });
  }
props.add(factory.createBatch(specs));
for (const [i, [x, z, color]] of [
  [0.55, 4.06, "blue"],
  [0.83, 3.83, "red"],
].entries()) {
  const [normal, roughness] = await Promise.all([
    tl.loadAsync(asset(`dice-wear-${i + 1}.png`)),
    tl.loadAsync(asset(`dice-roughness-${i + 1}.png`)),
  ]);
  for (const t of [normal, roughness]) {
    t.flipY = false;
    t.colorSpace = THREE.NoColorSpace;
  }
  const die = diceModel.scene.clone(true);
  die.scale.setScalar(0.24);
  die.rotation.y = i ? -0.4 : 0.25;
  die.position.set(x, 0, z);
  die.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = o.receiveShadow = true;
      if (o.material.name === "DiceBody")
        o.material = createDiceMaterial(
          { color, finish: "solid" },
          normal,
          roughness,
        );
    }
  });
  die.position.y = 0.615 - new THREE.Box3().setFromObject(die).min.y;
  props.add(die);
}
const local = createLocalReflections(renderer, { scene, board, artwork });
const contact = createContactShadows(key, {
  maxTextureSize: renderer.capabilities.maxTextureSize,
});
const flare = createLensFlares(renderer);
const sources = findPanoramaFlareSources(hdr, shell);
function pose(shot) {
  if (shot === "macro") {
    camera.position.set(-0.7, 1.45, 5.25);
    camera.lookAt(0.23, 0.78, 3.9);
    camera.fov = 39;
  } else {
    camera.position.set(-1.2, 1.04, 4.65);
    camera.lookAt(0.1, 1.02, 3.75);
    camera.fov = 54;
  }
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
}
function draw() {
  artwork.render(camera, { width, height });
  renderer.setRenderTarget(null);
  renderer.setViewport(0, 0, width, height);
  renderer.setScissorTest(false);
  renderer.render(scene, camera);
  flare.render(camera, { sources });
  renderer.getContext().finish();
}
window.effectsStudy = {
  ready: true,
  async capture(shot, mode) {
    pose(shot);
    const localOn = ["on", "reflections"].includes(mode);
    contact.setEnabled(["on", "shadows"].includes(mode));
    flare.setEnabled(["on", "flares"].includes(mode));
    local.setEnabled(localOn);
    renderer.shadowMap.needsUpdate = true;
    draw();
    if (localOn) {
      local.update(camera, { safe: true, revision: shot, time: 0 });
      for (let i = 0; i < 6; i++) {
        local.update(camera, {
          safe: true,
          revision: shot,
          time: 700 + i * 20,
        });
        await new Promise(requestAnimationFrame);
      }
    }
    draw();
    draw();
    return {
      shot,
      mode,
      image: renderer.domElement.toDataURL("image/png"),
      camera: camera.position.toArray(),
      target: camera.getWorldDirection(new THREE.Vector3()).toArray(),
      fov: camera.fov,
      contactSize: contact.size,
      reflections: local.metrics,
      flareSources: flare.activeSources,
      flareResources: flare.allocatedSources,
      lampProjections: sources.map((s) =>
        s.position.clone().project(camera).toArray(),
      ),
      width,
      height,
    };
  },
};
