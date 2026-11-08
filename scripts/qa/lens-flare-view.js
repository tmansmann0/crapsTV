// Isolated GPU regression fixture; never imported by the production client.
import * as THREE from "three";
import { createLensFlares } from "/src/lens-flare.js";
import { createTableCompositor } from "/src/table-compositor.js";

const width = 960,
  height = 540;
const renderer = new THREE.WebGLRenderer({
  antialias: false,
  preserveDrawingBuffer: true,
});
renderer.autoClear = false;
renderer.setPixelRatio(1);
renderer.setSize(width, height);
document.body.style.margin = "0";
document.body.append(renderer.domElement);
const world = new THREE.Scene();
world.background = new THREE.Color(0x070c0b);
const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100);
camera.updateMatrixWorld(true);
const table = new THREE.Mesh(
  new THREE.BoxGeometry(10, 0.15, 5),
  new THREE.MeshBasicMaterial({ color: 0x123d2a }),
);
table.position.set(0, -1, -5);
world.add(table);
const source = { position: new THREE.Vector3(-1.4, 0.8, -6) };
const lamp = new THREE.Mesh(
  new THREE.SphereGeometry(0.055, 16, 8),
  new THREE.MeshBasicMaterial({ color: 0xffdcaa }),
);
lamp.position.copy(source.position);
world.add(lamp);
const occluder = new THREE.Mesh(
  new THREE.BoxGeometry(1.3, 1.3, 0.2),
  new THREE.MeshBasicMaterial({ color: 0x263932 }),
);
occluder.position.copy(source.position).multiplyScalar(0.6);
world.add(occluder);
const chip = new THREE.InstancedMesh(
  new THREE.CylinderGeometry(0.7, 0.7, 0.4, 32),
  new THREE.MeshBasicMaterial({ color: 0x38343b }),
  1,
);
const chipMatrix = new THREE.Matrix4().compose(
  occluder.position,
  new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(1, 0, 0),
    Math.PI / 2,
  ),
  new THREE.Vector3(1, 1, 1),
);
chip.setMatrixAt(0, chipMatrix);
world.add(chip);
const compositor = createTableCompositor(renderer);
compositor.setNativeSurface(table);
const effects = createLensFlares(renderer);
const sources = [source];

// A native-resolution text/QR-like UI sample rendered after the optical pass.
const uiCanvas = document.createElement("canvas");
uiCanvas.width = 320;
uiCanvas.height = 100;
const ctx = uiCanvas.getContext("2d");
ctx.fillStyle = "#101c18";
ctx.fillRect(0, 0, 320, 100);
ctx.fillStyle = "#fff";
ctx.font = "20px sans-serif";
ctx.fillText("JOIN TABLE · 3840", 14, 30);
for (let y = 0; y < 9; y++)
  for (let x = 0; x < 9; x++) {
    ctx.fillStyle = (x * 7 + y * 3) % 5 < 2 ? "#000" : "#fff";
    ctx.fillRect(14 + x * 5, 44 + y * 5, 5, 5);
  }
const uiTexture = new THREE.CanvasTexture(uiCanvas);
uiTexture.colorSpace = THREE.SRGBColorSpace;
const ui = new THREE.Scene();
const uiCamera = new THREE.OrthographicCamera(
  -width / 2,
  width / 2,
  height / 2,
  -height / 2,
  0,
  2,
);
uiCamera.position.z = 1;
const uiQuad = new THREE.Mesh(
  new THREE.PlaneGeometry(320, 100),
  new THREE.MeshBasicMaterial({
    map: uiTexture,
    toneMapped: false,
    depthTest: false,
    depthWrite: false,
  }),
);
uiQuad.position.set(240, -100, 0);
ui.add(uiQuad);
window.lensFlarePreview = {
  ready: true,
  capture({
    enabled,
    obstruction = "none",
    location = "visible",
    split = false,
  }) {
    compositor.resize({
      width,
      height,
      devicePixelRatio: 1,
      scenePixelRatio: split ? 0.75 : 1,
      antialias: false,
    });
    source.position.set(
      location === "offscreen" ? 30 : -1.4,
      0.8,
      location === "behind" ? 6 : -6,
    );
    lamp.position.copy(source.position);
    occluder.visible = obstruction === "table";
    chip.visible = obstruction === "chip";
    effects.setEnabled(enabled);
    compositor.render(world, camera);
    effects.render(camera, { sources });
    renderer.clearDepth();
    renderer.render(ui, uiCamera);
    return {
      image: renderer.domElement.toDataURL(),
      textures: renderer.info.memory.textures,
      geometries: renderer.info.memory.geometries,
      active: effects.activeSources,
      allocated: effects.allocatedSources,
      split: compositor.plan.split,
    };
  },
};
