import * as THREE from "three";
import { createTableCompositor } from "/src/table-compositor.js";
import { createBoardArtwork } from "/src/board-artwork.js";
import { createBoardMaterial } from "/src/board-material.js";
import { createTextureQuality } from "/src/texture-quality.js";
const options = new URLSearchParams(location.search),
  W = Number(options.get("width") || 3840),
  H = Number(options.get("height") || 2160);
const renderer = new THREE.WebGLRenderer({
  antialias: options.get("aa") !== "0",
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
document.body.append(renderer.domElement);
const scene = new THREE.Scene(),
  camera = new THREE.PerspectiveCamera(43, W / H, 0.035, 100);
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
const wool = await new THREE.TextureLoader().loadAsync(
  "/assets/felt-studies/wool-fibres.png",
);
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
const solid = new THREE.Mesh(
  new THREE.CylinderGeometry(0.28, 0.28, 0.2, 48),
  new THREE.MeshBasicMaterial({ color: 0x126bd1 }),
);
solid.position.set(0, 0.125, 1.69);
solid.castShadow = true;
scene.add(solid);
const ghost = solid.clone();
ghost.material = solid.material.clone();
ghost.material.transparent = true;
ghost.material.opacity = 0.35;
ghost.material.depthWrite = false;
ghost.position.x = -0.8;
scene.add(ghost);
const cap = createTextureQuality(4096);
cap.register(wool);
const woodMap = await new THREE.TextureLoader().loadAsync(
  "/assets/wood-studies/american/albedo.jpg",
);
woodMap.colorSpace = THREE.SRGBColorSpace;
cap.register(woodMap);
const wood = new THREE.Mesh(
  new THREE.BoxGeometry(11.5, 0.2, 6),
  new THREE.MeshStandardMaterial({ map: woodMap }),
);
wood.position.y = -0.15;
scene.add(wood);
const compositor = createTableCompositor(renderer);
compositor.setNativeSurface(board);
const art = createBoardArtwork(renderer, {
  board,
  resolveAsset: (name) => "/assets/" + name,
  samples: Number(options.get("samples") || 4),
});
await art.ready;
const poison = new THREE.DataTexture(new Uint8Array([255, 0, 255, 255]), 1, 1);
poison.needsUpdate = true;
function pose(name) {
  if (name === "macro") {
    camera.position.set(-3.48, 0.8, -1.006);
    camera.lookAt(-3.48, 0.012, -1.01);
  } else {
    camera.position.set(0, 7, 3.4);
    camera.lookAt(0, 0, 0);
  }
  camera.updateMatrixWorld();
}
function pixelAt(point) {
  const q = point.clone().project(camera),
    out = new Uint8Array(4);
  renderer
    .getContext()
    .readPixels(
      Math.round(((q.x + 1) * W) / 2),
      Math.round(((q.y + 1) * H) / 2),
      1,
      1,
      renderer.getContext().RGBA,
      renderer.getContext().UNSIGNED_BYTE,
      out,
    );
  return [...out];
}
async function hashInk() {
  const p = new Uint8Array(W * H * 4);
  renderer.readRenderTargetPixels(art.target, 0, 0, W, H, p);
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", p))]
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("");
}
function bufferInfo() {
  const gl = renderer.getContext(),
    p = renderer.properties.get(art.target),
    old = gl.getParameter(gl.RENDERBUFFER_BINDING);
  const result = {};
  for (const [name, buffer] of [
    ["color", p.__webglColorRenderbuffer?.[0]],
    ["depth", p.__webglDepthRenderbuffer],
  ])
    if (buffer) {
      gl.bindRenderbuffer(gl.RENDERBUFFER, buffer);
      result[name + "Samples"] = gl.getRenderbufferParameter(
        gl.RENDERBUFFER,
        gl.RENDERBUFFER_SAMPLES,
      );
      result[name + "Format"] = gl.getRenderbufferParameter(
        gl.RENDERBUFFER,
        gl.RENDERBUFFER_INTERNAL_FORMAT,
      );
    }
  gl.bindRenderbuffer(gl.RENDERBUFFER, old);
  return result;
}
window.proof = {
  ready: true,
  async render(
    mode = "classic",
    scale = 0.75,
    nativePrint = true,
    { view = "overview", textureLimit = 1024, poisonAtlas = false } = {},
  ) {
    pose(view);
    art.select(mode);
    cap.setLimit(textureLimit);
    board.material.map = poisonAtlas ? poison : null;
    if (!art.fallbackTexture.userData.referenceImage)
      art.fallbackTexture.userData.referenceImage = art.fallbackTexture.image;
    // The poison changes image dimensions. Release immutable GPU storage so
    // this actually uploads the replacement rather than retaining old pixels.
    art.fallbackTexture.dispose();
    if (poisonAtlas) {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 4;
      const c = canvas.getContext("2d");
      c.fillStyle = "#ff00ff";
      c.fillRect(0, 0, 4, 4);
      art.fallbackTexture.image = canvas;
    } else
      art.fallbackTexture.image = art.fallbackTexture.userData.referenceImage;
    art.fallbackTexture.needsUpdate = true;
    board.material.needsUpdate = true;
    const plan = compositor.resize({
      width: W,
      height: H,
      devicePixelRatio: 1,
      scenePixelRatio: scale,
      antialias: options.get("aa") !== "0",
    });
    compositor.setNativeSurface(nativePrint ? board : null);
    await art.compile(camera, { width: plan.uiWidth, height: plan.uiHeight });
    await compositor.compile(scene, camera);
    renderer.info.reset();
    renderer.shadowMap.needsUpdate = true;
    art.render(camera, { width: plan.uiWidth, height: plan.uiHeight });
    compositor.render(scene, camera);
    const point = new THREE.Vector3(
        ...(view === "macro" ? [-3.48, 0.012, -1.01] : [0, 0.012, -0.35]),
      ).project(camera),
      patch = new Uint8Array(512 * 100 * 4);
    renderer
      .getContext()
      .readPixels(
        Math.round(((point.x + 1) * W) / 2) - 256,
        Math.round(((point.y + 1) * H) / 2) - 50,
        512,
        100,
        renderer.getContext().RGBA,
        renderer.getContext().UNSIGNED_BYTE,
        patch,
      );
    const inkHash = await hashInk();
    return {
      plan,
      printSource: "native-svg-geometry",
      ...art.metrics,
      buffer: bufferInfo(),
      inkHash,
      modeledTextureWidth: woodMap.image.width,
      solidPixel: view === "overview" ? pixelAt(solid.position) : null,
      ghostPixel: view === "overview" ? pixelAt(ghost.position) : null,
      patch: [...patch],
      calls: renderer.info.render.calls,
      triangles: renderer.info.render.triangles,
    };
  },
  async edges() {
    const p = new Uint8Array(W * H * 4);
    renderer
      .getContext()
      .readPixels(
        0,
        0,
        W,
        H,
        renderer.getContext().RGBA,
        renderer.getContext().UNSIGNED_BYTE,
        p,
      );
    return { width: W, height: H, pixels: [...p] };
  },
};
