import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { EXRLoader } from "three/addons/loaders/EXRLoader.js";
import { createTableMaterials } from "/src/table-materials.js";
import { createChipFactory } from "/src/chip-rendering.js";
import { chipStackPose } from "/src/chip-character.js";
import { createRasterBoardArtwork } from "/src/board-raster-artwork.js";
import { createBoardMaterial } from "/src/board-material.js";
import { createDiceMaterial } from "/src/dice-material.js";
import {
  MATERIAL_LOOKS,
  createMaterialLookController,
} from "/src/material-look.js";
import { createChipScratchPreview } from "/src/chip-scratch-preview.js";
import { createWoodLookPreview } from "/src/wood-look.js";
import { createFeltSurface } from "/src/felt-material.js";
const asset = (name) => "/assets/" + name;
const fixtureParams = new URLSearchParams(location.search);
const production = fixtureParams.has("production");
const selectedFelt = fixtureParams.get("selectedFelt") === "soft-wool";
const initialWidth = Number(fixtureParams.get("width")) || 3840;
const initialHeight = Number(fixtureParams.get("height")) || 2160;
const renderer = new THREE.WebGLRenderer({
  antialias: true,
  preserveDrawingBuffer: true,
});
renderer.setPixelRatio(1);
renderer.setSize(initialWidth, initialHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.9;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.style.margin = "0";
document.body.style.background = "black";
renderer.domElement.style.cssText =
  "width:100vw;height:100vh;object-fit:contain;display:block";
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(35, 16 / 9, 0.015, 160);
const environment = await new EXRLoader().loadAsync(asset("casino-room.exr"));
environment.mapping = THREE.EquirectangularReflectionMapping;
const pmrem = new THREE.PMREMGenerator(renderer);
const envTarget = pmrem.fromEquirectangular(environment);
scene.environment = envTarget.texture;
scene.environmentIntensity = 1.2;
scene.environmentRotation.y = Math.PI / 2;
const shell = new THREE.Mesh(
  new THREE.SphereGeometry(42, 64, 32),
  new THREE.MeshBasicMaterial({
    map: environment,
    side: THREE.BackSide,
    color: 0xd4d4d4,
  }),
);
shell.position.y = 2.2;
shell.rotation.y = Math.PI / 2;
scene.add(shell);
scene.add(new THREE.HemisphereLight(0xc6d9ce, 0x18251e, 0.38));
const key = new THREE.DirectionalLight(0xffe5c6, 2.5);
key.position.set(-4, 10, 4);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
Object.assign(key.shadow.camera, {
  left: -9,
  right: 9,
  top: 7,
  bottom: -7,
  near: 1,
  far: 30,
});
key.shadow.bias = -0.0002;
key.shadow.normalBias = 0.02;
scene.add(key);
const rim = new THREE.DirectionalLight(0xf3d4a3, 1.1);
rim.position.set(7, 4, -7);
scene.add(rim);
const loader = new GLTFLoader(),
  tl = new THREE.TextureLoader();
const [model, materials, factory, layout] = await Promise.all([
  loader.loadAsync(asset("table-player-rails-optimized.glb")),
  createTableMaterials(renderer, {
    resolveAsset: asset,
    ...(production ? {} : { surfaceProfile: false }),
  }),
  createChipFactory(renderer, {
    resolveAsset: asset,
    ...(production ? {} : { surfaceProfile: false }),
  }),
  fetch(asset("table-player-rails-layout.json")).then((r) => r.json()),
]);
materials.apply(model.scene);
model.scene.traverse((o) => {
  if (o.isMesh) o.castShadow = o.receiveShadow = true;
});
scene.add(model.scene);
async function data(name) {
  const t = await tl.loadAsync(asset(name));
  t.flipY = false;
  t.colorSpace = THREE.NoColorSpace;
  t.anisotropy = 8;
  return t;
}
const [feltNormal, feltRoughness] = await Promise.all([
  data(production ? "felt-studies/wool-fibres.png" : "felt-normal.png"),
  data("felt-roughness.png"),
]);
for (const t of [feltNormal, feltRoughness]) {
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(10.84 / 0.46, 5.4 / 0.46);
}
const artwork = createRasterBoardArtwork(renderer, {
  resolveAsset: asset,
  deviceMemory: 8,
  mobile: false,
  software: fixtureParams.has("software"),
});
await artwork.ready;
const board = new THREE.Mesh(
  new THREE.PlaneGeometry(10.84, 5.4),
  createBoardMaterial({
    normalMap: feltNormal,
    roughnessMap: feltRoughness,
    ...(production ? {} : { surfaceProfile: false }),
  }),
);
board.material.map = artwork.texture;
board.material.userData.materialLookKind = "felt";
board.rotation.x = -Math.PI / 2;
board.position.y = 0.012;
board.receiveShadow = true;
scene.add(board);
const specs = [];
function pile(seed, x, y, z, count, denomination, diameter = 0.23) {
  for (let n = 0; n < count; n++) {
    const pose = chipStackPose(seed, n, { diameter, thicknessScale: 1.3 });
    specs.push({
      id: `${seed}-${n}`,
      denomination,
      wear: (n + seed.length) % 3,
      diameter,
      thicknessScale: 1.3,
      position: [
        x + pose.position[0],
        y + pose.position[1],
        z + pose.position[2],
      ],
      rotation: pose.rotation,
    });
  }
}
const denominations = [100, 500, 2500, 10000, 50000, 100000];
for (const seat of layout.seats.filter((s) => [1, 2, 3].includes(s.seat))) {
  for (const [i, slot] of seat.stackSlots.entries()) {
    const [x, y, z] = slot.position;
    pile(
      `bank-${seat.id}-${i}`,
      x,
      y,
      z,
      [12, 17, 19, 13, 9, 4, 7, 9, 5, 3][i],
      denominations[(i + seat.seat) % 6],
    );
  }
}
// Same persistent, slightly hand-placed chip geometry as player wagers.
pile("main-pass", -1.18, 0.012, 1.79, 9, 500, 0.31);
pile("main-odds", -0.68, 0.012, 2.18, 6, 2500, 0.31);
pile("field-win", 0.02, 0.012, 1.12, 4, 10000, 0.31);
pile("come", -1.75, 0.012, 0.2, 5, 100000, 0.31);
pile("place-six", -0.9, 0.012, -1.07, 7, 2500, 0.31);
pile("neighbor-pass", 1.3, 0.012, 1.77, 8, 50000, 0.31);
for (const [i, position] of [
  [-0.34, 0.012, 1.74],
  [-0.1, 0.012, 1.94],
  [0.33, 0.012, 1.84],
  [-1.72, 0.012, 2.14],
].entries()) {
  pile(`loose-${i}`, ...position, 1, [100, 500, 2500, 10000][i], 0.31);
}
const chips = factory.createBatch(specs);
scene.add(chips);
const dieModel = (await loader.loadAsync(asset("dice.glb"))).scene;
const diceMaps = [];
for (let i = 0; i < 2; i++) {
  const [normal, rough] = await Promise.all([
    data(`dice-wear-${i + 1}.png`),
    data(`dice-roughness-${i + 1}.png`),
  ]);
  diceMaps.push(normal, rough);
  const die = dieModel.clone(true);
  die.scale.setScalar(0.24);
  die.position.set(0.48 + i * 0.35, 0.12, 1.1 - i * 0.17);
  die.rotation.y = 0.2 + i * 0.7;
  die.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = o.receiveShadow = true;
      if (o.material.name === "DiceBody")
        o.material = createDiceMaterial(
          { color: i ? "blue" : "red", finish: "solid" },
          normal,
          rough,
          false,
          production ? {} : { surfaceProfile: false },
        );
    }
  });
  scene.add(die);
}
// Historical studies retain their original C-felt recipe unless this explicit
// parity mode asks for the newer approved material. The reference applies the
// authored B values independently to raw materials, rather than using the
// production board/table factory selection path.
const referenceWool = [],
  referenceWoolAtlases = [];
if (selectedFelt && !production) {
  const atlas = await data("felt-studies/wool-fibres.png");
  referenceWoolAtlases.push(atlas);
  atlas.wrapS = atlas.wrapT = THREE.RepeatWrapping;
  const found = new Set();
  scene.traverse((object) => {
    if (
      object.material?.userData?.materialLookKind === "felt" ||
      ["Deep pine baize", "Player tray suede"].includes(object.material?.name)
    )
      found.add(object.material);
  });
  for (const material of found) {
    const controller = createFeltSurface(material, atlas);
    controller.apply({
      relief: 0.7,
      tile: 0.43,
      sheen: 0.75,
      sheenRoughness: 0.69,
      sheenColor: "#47775a",
      nap: 0.035,
      colour: 0.035,
      fibre: 0.09,
    });
    referenceWool.push(controller);
  }
}
const lookRoot = selectedFelt
  ? {
      traverse(visitor) {
        scene.traverse((object) => {
          const m = object.material;
          if (
            m &&
            (m.userData?.materialLookKind === "felt" ||
              ["Deep pine baize", "Player tray suede"].includes(m.name))
          )
            return;
          visitor(object);
        });
      },
    }
  : scene;
const controller = production ? null : createMaterialLookController(lookRoot);
const scratchAtlas = production ? null : await data("chip-scratch-study.png");
if (scratchAtlas)
  scratchAtlas.wrapS = scratchAtlas.wrapT = THREE.RepeatWrapping;
const scratchPreview = production
  ? null
  : createChipScratchPreview(scene, scratchAtlas);
const woodPreview = production
  ? null
  : await createWoodLookPreview(scene, {
      renderer,
      resolveAsset: asset,
    });
let selectedWood = "american";
const views = {
  hero: { position: [0.1, 2.8, 5.05], target: [-0.9, 0.5, 2.8], fov: 34 },
  wide: { position: [0.15, 4.7, 7.3], target: [-0.8, 0.3, 2.3], fov: 38 },
};
window.materialLookPreview = {
  ready: true,
  looks: MATERIAL_LOOKS,
  setWoodLook(id) {
    selectedWood = id;
  },
  verifyVariants() {
    const variants = factory.createBatch(
      denominations.flatMap((denomination, d) =>
        [0, 1, 2].flatMap((wear) =>
          [1, 0.35].map((opacity, o) => ({
            id: `shader-${denomination}-${wear}-${opacity}`,
            denomination,
            wear,
            opacity,
            diameter: 0.23,
            position: [-1.5 + d * 0.35, 0.2 + wear * 0.13, 1 + o * 0.35],
          })),
        ),
      ),
    );
    scene.add(variants);
    const results = [];
    for (const detail of ["full", "optimized"]) {
      factory.updateLOD(variants, camera, 2160, detail);
      renderer.render(scene, camera);
      results.push({
        detail,
        cases: 36,
        activeDraws: variants.children.filter((m) => m.visible && m.count)
          .length,
      });
    }
    variants.removeFromParent();
    variants.traverse((o) => {
      if (o.isInstancedMesh) o.dispose();
    });
    return results;
  },
  render(id = "baseline", shot = "hero", { width = 3840, height = 2160 } = {}) {
    const revised = ["mixed", "refined", "scratch-forward"].includes(id);
    if (!production) {
      if (!revised) woodPreview.apply("original");
      controller.apply(id);
      if (revised) woodPreview.apply(selectedWood);
      scratchPreview.apply(MATERIAL_LOOKS[id].chip.scratch);
    }
    const view = views[shot];
    if (!view) throw Error("Unknown shot");
    renderer.setSize(width, height);
    camera.aspect = width / height;
    camera.fov = view.fov;
    camera.position.fromArray(view.position);
    camera.lookAt(...view.target);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    factory.updateLOD(chips, camera, height, "auto");
    renderer.info.reset();
    renderer.render(scene, camera);
    const gl = renderer.getContext();
    const debug = gl.getExtension("WEBGL_debug_renderer_info");
    return {
      id,
      shot,
      width: renderer.domElement.width,
      height: renderer.domElement.height,
      camera: view,
      production,
      feltLook:
        production || selectedFelt
          ? "B soft wool — material only"
          : "Historical look profile",
      profile: controller ? controller.describe(id) : MATERIAL_LOOKS.refined,
      woodLook: woodPreview
        ? woodPreview.describe(revised ? selectedWood : "original")
        : { label: "Dark American walnut", production: true },
      chips: specs.length,
      sharedStudyMaterials: controller?.materialCount ?? 0,
      calls: renderer.info.render.calls,
      triangles: renderer.info.render.triangles,
      drawBuffers: [gl.drawingBufferWidth, gl.drawingBufferHeight],
      gpu: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : "WebGL",
      exposure: renderer.toneMappingExposure,
      environmentIntensity: scene.environmentIntensity,
      lighting: "Unchanged game casino EXR, hemisphere .38, key 2.5, rim 1.1",
      model: "table-player-rails-optimized.glb",
      geometryUnchanged: true,
    };
  },
  image(type = "image/jpeg", quality = 0.94) {
    return renderer.domElement.toDataURL(type, quality);
  },
  dispose() {
    referenceWool.forEach((controller) => controller.dispose());
    referenceWoolAtlases.forEach((texture) => texture.dispose());
    for (const texture of [feltNormal, feltRoughness, ...diceMaps])
      texture.dispose();
    woodPreview?.dispose();
    scratchPreview?.dispose();
    scratchAtlas?.dispose();
    controller?.dispose();
    factory.dispose();
    materials.dispose();
    artwork.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
  },
};
window.materialLookPreview.render("baseline", "hero", {
  width: initialWidth,
  height: initialHeight,
});
