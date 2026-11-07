import * as THREE from "three";
import { createTableCompositor } from "/src/table-compositor.js";
import { createBoardArtwork } from "/src/board-artwork.js";
import { createTextureQuality } from "/src/texture-quality.js";
const renderer = new THREE.WebGLRenderer({
  antialias: true,
  preserveDrawingBuffer: true,
});
renderer.autoClear = false;
renderer.info.autoReset = false;
renderer.shadowMap.enabled = true;
renderer.shadowMap.autoUpdate = false;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.setClearColor(0x151b17);
document.body.style.margin = "0";
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(43, 16 / 9, 0.035, 100);
camera.position.set(0, 7, 3.4);
camera.lookAt(0, 0, 0);
scene.add(new THREE.HemisphereLight(0xffffff, 0x283b28, 2));
const light = new THREE.DirectionalLight(0xffffff, 2);
light.position.set(-3, 7, 4);
light.castShadow = true;
light.shadow.mapSize.set(1024, 1024);
Object.assign(light.shadow.camera, {
  left: -6,
  right: 6,
  top: 4,
  bottom: -4,
  near: 1,
  far: 20,
});
scene.add(light);
const board = new THREE.Mesh(
  new THREE.PlaneGeometry(10.84, 5.4),
  new THREE.MeshStandardMaterial({ roughness: 0.98 }),
);
board.rotation.x = -Math.PI / 2;
board.position.y = 0.012;
board.receiveShadow = true;
scene.add(board);
// A chip-sized blue solid deliberately covers the printed pass-line lettering.
const solid = new THREE.Mesh(
  new THREE.CylinderGeometry(0.28, 0.28, 0.2, 48),
  new THREE.MeshBasicMaterial({ color: 0x126bd1, toneMapped: true }),
);
solid.position.set(0, 0.125, 1.69);
solid.castShadow = true;
scene.add(solid);
const ghost = solid.clone();
ghost.material = solid.material.clone();
ghost.material.transparent = true;
ghost.material.opacity = 0.35;
ghost.position.x = -0.8;
scene.add(ghost);
const compositor = createTableCompositor(renderer);
compositor.setNativeSurface(board);
const art = createBoardArtwork(renderer, {
  resolveAsset: (name) => "/assets/" + name,
  deviceMemory: 8,
  mobile: false,
});
await art.ready;
const cap = createTextureQuality(4096);
const woodMap = await new THREE.TextureLoader().loadAsync(
  "/assets/material-table-walnut-albedo.jpg",
);
woodMap.colorSpace = THREE.SRGBColorSpace;
cap.register(woodMap);
const wood = new THREE.Mesh(
  new THREE.BoxGeometry(11.5, 0.2, 6),
  new THREE.MeshStandardMaterial({ map: woodMap }),
);
wood.position.y = -0.15;
scene.add(wood);
board.material.map = art.texture;
board.material.needsUpdate = true;
camera.updateMatrixWorld();
const point = solid.position.clone().project(camera);
const ghostPoint = ghost.position.clone().project(camera);
const patchPoint = new THREE.Vector3(0, 0.012, -0.35).project(camera);
window.proof = {
  ready: true,
  async lifecycle() {
    const disposable = createBoardArtwork(renderer, {
      resolveAsset: (name) => "/assets/" + name,
      software: true,
    });
    disposable.dispose();
    await disposable.ready;
    if (disposable.texture)
      throw Error("Disposed pending load retained texture");
    const rapid = createBoardArtwork(renderer, {
      resolveAsset: (name) => "/assets/" + name,
      software: true,
    });
    rapid.select("crapless");
    await rapid.ready;
    if (rapid.mode !== "crapless")
      throw Error("Initial mode changed during decode");
    const previous = rapid.texture;
    rapid.select("classic");
    for (let i = 0; i < 300 && rapid.mode !== "classic"; i++)
      await new Promise((r) => setTimeout(r, 10));
    if (rapid.mode !== "classic" || previous.image.width !== 0)
      throw Error("Mode replacement retained old bitmap");
    const final = rapid.texture;
    rapid.dispose();
    if (final.image.width !== 0) throw Error("Active bitmap was not closed");
    const failed = createBoardArtwork(renderer, {
      resolveAsset: () => "data:image/svg+xml,broken",
      software: true,
    });
    let rejected = false;
    try {
      await failed.ready;
    } catch {
      rejected = true;
    }
    failed.select("crapless");
    failed.dispose();
    if (!rejected) throw Error("Invalid SVG did not fail readiness");
    return {
      pendingDispose: true,
      initialModeChange: true,
      oldBitmapClosed: true,
      activeBitmapClosed: true,
      invalidSourceRejected: true,
    };
  },
  async render(mode = "classic", scale = 0.75, nativePrint = true) {
    art.select(mode);
    for (let i = 0; i < 300 && art.mode !== mode; i++)
      await new Promise((r) => setTimeout(r, 10));
    if (art.mode !== mode) throw Error("Artwork mode switch failed");
    board.material.map = art.texture;
    board.material.needsUpdate = true;
    // Exercise the real cap manager, which has no ownership of print textures.
    cap.setLimit(1024);
    const plan = compositor.resize({
      width: 3840,
      height: 2160,
      devicePixelRatio: 1,
      scenePixelRatio: scale,
      antialias: true,
    });
    compositor.setNativeSurface(nativePrint ? board : null);
    renderer.info.reset();
    await compositor.compile(scene, camera);
    renderer.shadowMap.needsUpdate = true;
    compositor.render(scene, camera);
    const pixels = new Uint8Array(4);
    renderer
      .getContext()
      .readPixels(
        Math.round((point.x + 1) * 1920),
        Math.round((point.y + 1) * 1080),
        1,
        1,
        renderer.getContext().RGBA,
        renderer.getContext().UNSIGNED_BYTE,
        pixels,
      );
    const ghostPixel = new Uint8Array(4);
    renderer
      .getContext()
      .readPixels(
        Math.round((ghostPoint.x + 1) * 1920),
        Math.round((ghostPoint.y + 1) * 1080),
        1,
        1,
        renderer.getContext().RGBA,
        renderer.getContext().UNSIGNED_BYTE,
        ghostPixel,
      );
    const patch = new Uint8Array(512 * 100 * 4);
    renderer
      .getContext()
      .readPixels(
        Math.round((patchPoint.x + 1) * 1920) - 256,
        Math.round((patchPoint.y + 1) * 1080) - 50,
        512,
        100,
        renderer.getContext().RGBA,
        renderer.getContext().UNSIGNED_BYTE,
        patch,
      );
    return {
      patch: [...patch],
      ghostPixel: [...ghostPixel],
      plan,
      width: art.texture.image.width,
      height: art.texture.image.height,
      printSource: art.texture.name,
      modeledTextureWidth: woodMap.image.width,
      solidPixel: [...pixels],
      calls: renderer.info.render.calls,
      triangles: renderer.info.render.triangles,
    };
  },
};
