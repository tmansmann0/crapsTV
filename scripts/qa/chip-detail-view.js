import * as THREE from "three";
import { EXRLoader } from "three/addons/loaders/EXRLoader.js";
import { createChipFactory } from "/src/chip-rendering.js";
import { createTextureQuality } from "/src/texture-quality.js";
const diagnostic =
  new URLSearchParams(location.search).get("diagnostic") || "lit";
const renderer = new THREE.WebGLRenderer({
  antialias: true,
  preserveDrawingBuffer: true,
});
renderer.setSize(3840, 2160);
renderer.setPixelRatio(1);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.9;
document.body.style.margin = "0";
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color("#183229");
const environment = await new EXRLoader().loadAsync("/assets/casino-room.exr");
environment.mapping = THREE.EquirectangularReflectionMapping;
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromEquirectangular(environment).texture;
scene.environmentIntensity = 1.2;
scene.environmentRotation.y = Math.PI / 2;
scene.add(new THREE.HemisphereLight(0xc6d9ce, 0x18251e, 0.38));
for (const [col, power, pos] of [
  [0xffe5c6, 2.5, [-4, 10, 4]],
  [0xf3d4a3, 1.1, [7, 4, -7]],
]) {
  const l = new THREE.DirectionalLight(col, power);
  l.position.fromArray(pos);
  scene.add(l);
}
const camera = new THREE.OrthographicCamera(-1.6, 1.6, 0.9, -0.9, 0.01, 30);
camera.up.set(0, 0, -1);
camera.position.set(0, 6, 0);
camera.lookAt(0, 0, 0);
const frontal = new URLSearchParams(location.search).has("frontal");
if (frontal) {
  camera.up.set(0, 1, 0);
  camera.position.set(0, 0.08, 6);
  camera.lookAt(0, 0.08, 0);
}
camera.updateMatrixWorld();
const factory = await createChipFactory(renderer, {
  resolveAsset: (n) => "/assets/" + n,
});
const cap = createTextureQuality(Infinity),
  batches = [];
function build(flip) {
  for (const b of batches) {
    b.removeFromParent();
    b.traverse((o) => {
      if (o.isInstancedMesh) o.dispose();
    });
  }
  batches.length = 0;
  for (let i = 0; i < 2; i++) {
    const batch = factory.createBatch([
      {
        id: `detail-${i}`,
        denomination: new URLSearchParams(location.search).has("orange")
          ? 100000
          : 500,
        wear: 1,
        diameter: 1.24,
        thicknessScale: 1.3,
        position: [i ? 0.73 : -0.73, 0.08, 0],
        rotation: [
          (i ^ flip ? Math.PI : 0) + (frontal ? Math.PI / 2 : 0),
          0,
          0,
        ],
      },
    ]);
    scene.add(batch);
    batches.push(batch);
    factory.updateLOD(batch, camera, 2160, i ? "optimized" : "full");
    batch.traverse((o) => {
      for (const m of o.material ? [o.material] : []) {
        if (diagnostic === "no-normals" || diagnostic === "flat-albedo")
          m.normalScale?.set(0, 0);
        if (diagnostic === "flat-albedo") {
          m.metalness = 0;
          m.roughnessMap = null;
          m.roughness = 1;
          m.envMapIntensity = 0;
          m.aoMap = null;
        }
        if (!m.userData.proofDiagnostic && diagnostic !== "lit") {
          m.userData.proofDiagnostic = true;
          const hook = m.onBeforeCompile,
            key = m.customProgramCacheKey();
          m.onBeforeCompile = (s, r) => {
            hook.call(m, s, r);
            if (diagnostic === "no-patina" || diagnostic === "flat-albedo")
              for (const k of [
                "chipPatinaStrength",
                "lookMacroGrime",
                "lookMacroScuff",
              ])
                if (s.uniforms[k]) s.uniforms[k].value = 0;
            if (diagnostic === "no-normals" || diagnostic === "flat-albedo")
              if (s.uniforms.chipScratchRelief)
                s.uniforms.chipScratchRelief.value = 0;
          };
          m.customProgramCacheKey = () => key + "/proof-" + diagnostic;
          m.needsUpdate = true;
        }
        for (const v of Object.values(m)) if (v?.isTexture) cap.register(v);
      }
    });
  }
}
window.proof = {
  ready: true,
  capture(limit = "native", flip = 0) {
    build(flip);
    cap.setLimit(limit === "native" ? Infinity : 1024);
    if (diagnostic === "flat-albedo") {
      scene.environmentIntensity = 0;
      scene.traverse((o) => {
        if (o.isDirectionalLight) o.intensity = 0;
        if (o.isHemisphereLight) {
          o.color.set(0xffffff);
          o.groundColor.set(0xffffff);
          o.intensity = 1;
        }
      });
    }
    renderer.render(scene, camera);
    const stamps = [];
    scene.traverse((o) => {
      if (o.material?.name === "ChipEngraving" && o.visible)
        stamps.push({
          color: [
            o.material.map.image.width || o.material.map.image.naturalWidth,
            o.material.map.image.height || o.material.map.image.naturalHeight,
          ],
          normal: [
            o.material.normalMap.image.width ||
              o.material.normalMap.image.naturalWidth,
            o.material.normalMap.image.height ||
              o.material.normalMap.image.naturalHeight,
          ],
          criticalMinimum: o.material.map.userData.minimumTextureSize || 0,
        });
    });
    return {
      limit,
      flip,
      stamps,
      drawBuffer: [renderer.domElement.width, renderer.domElement.height],
      calls: renderer.info.render.calls,
      triangles: renderer.info.render.triangles,
    };
  },
  image() {
    return renderer.domElement.toDataURL("image/png");
  },
};
window.proof.capture();
