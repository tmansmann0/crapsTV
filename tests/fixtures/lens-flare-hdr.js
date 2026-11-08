// Real production panorama, shell tessellation and lamp-facing camera.
import * as THREE from "three";
import { EXRLoader } from "three/addons/loaders/EXRLoader.js";
import { createLensFlares, findPanoramaFlareSources } from "/src/lens-flare.js";
import { createTableCompositor } from "/src/table-compositor.js";

const width = 1920,
  height = 1080;
const renderer = new THREE.WebGLRenderer({
  antialias: true,
  preserveDrawingBuffer: true,
});
renderer.autoClear = false;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.9;
document.body.style.margin = "0";
document.body.append(renderer.domElement);
const hdr = await new EXRLoader().loadAsync("/assets/casino-room.exr");
const world = new THREE.Scene();
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
world.add(shell);
const camera = new THREE.PerspectiveCamera(54, width / height, 0.02, 160);
camera.position.set(-1.2, 1.04, 4.65);
const target = new THREE.Vector3(0.1, 1.02, 3.75);
camera.lookAt(target);
camera.updateMatrixWorld(true);
const sources = findPanoramaFlareSources(hdr, shell);
const position = sources[0].position
  .clone()
  .sub(camera.position)
  .normalize()
  .multiplyScalar(2)
  .add(camera.position);
const material = new THREE.MeshBasicMaterial({ color: 0x263932 });
const blocker = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.8, 0.8), material);
blocker.position.copy(position);
world.add(blocker);
const chips = new THREE.InstancedMesh(
  new THREE.CylinderGeometry(0.5, 0.5, 0.2, 32),
  material,
  1,
);
chips.setMatrixAt(
  0,
  new THREE.Matrix4().compose(
    position,
    new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      camera.position.clone().sub(position).normalize(),
    ),
    new THREE.Vector3(1, 1, 1),
  ),
);
world.add(chips);
const table = new THREE.Mesh(
  new THREE.PlaneGeometry(10, 5),
  new THREE.MeshBasicMaterial({ color: 0x163c28 }),
);
table.rotation.x = -Math.PI / 2;
table.position.y = 0.61;
world.add(table);
const compositor = createTableCompositor(renderer);
compositor.setNativeSurface(table);
const flare = createLensFlares(renderer);
window.hdrFlare = {
  ready: true,
  capture({
    enabled = false,
    obstruction = "none",
    split = false,
    location = "visible",
  } = {}) {
    camera.lookAt(
      location === "visible"
        ? target
        : camera.position.clone().multiplyScalar(2).sub(target),
    );
    camera.updateMatrixWorld(true);
    blocker.visible = obstruction === "table";
    chips.visible = obstruction === "chip";
    compositor.resize({
      width,
      height,
      devicePixelRatio: 1,
      scenePixelRatio: split ? 0.75 : 1,
      antialias: true,
    });
    flare.setEnabled(enabled);
    compositor.render(world, camera);
    flare.render(camera, { sources });
    renderer.getContext().finish();
    return {
      image: renderer.domElement.toDataURL(),
      active: flare.activeSources,
      allocated: flare.allocatedSources,
      textures: renderer.info.memory.textures,
    };
  },
};
