import * as THREE from "three";
import { createReflectionFinish } from "./reflection-finish.js";

const eligible = (m) =>
  (m?.isMeshStandardMaterial || m?.isMeshPhysicalMaterial) &&
  (m.userData?.woodLook ||
    m.name === "Hand-polished dark walnut" ||
    m.name === "DiceBody" ||
    m.userData?.materialLookKind === "dice" ||
    (m.metalness > 0.3 && /brass|metal/i.test(m.name)));

/**
 * Optional cached raster reflections. Six stationary world views are captured
 * one per update; only complete, prefiltered cubes replace the previous probe.
 * The factory creates no targets/materials while disabled. createPMREM is a
 * test injection; production uses the renderer's normal PMREM implementation.
 */
export function createLocalReflections(
  renderer,
  {
    scene,
    board,
    artwork,
    size = 256,
    stableMs = 600,
    finishProfile = "medium",
    createPMREM = (r) => new THREE.PMREMGenerator(r),
  } = {},
) {
  const gl = renderer.getContext();
  const supported = Boolean(
    renderer.capabilities.isWebGL2 &&
    gl.getExtension("EXT_color_buffer_float") &&
    renderer.capabilities.maxCubemapSize >= 128,
  );
  const edge = Math.min(
    size >= 256 ? 256 : 128,
    renderer.capabilities.maxCubemapSize || 128,
  );
  const originals = new Map();
  let enabled = false,
    finish = null,
    disposed = false,
    cube = null,
    cubeCamera = null,
    generator = null,
    probeMaterial = null,
    probePrint = null,
    printSource = null,
    current = null,
    spare = null,
    face = 0,
    stableSince = null,
    seenRevision = Symbol("unseen"),
    committedRevision = Symbol("uncommitted"),
    captureRevision = null,
    state = "off",
    error = null,
    commits = 0,
    cancellations = 0,
    captureDraws = 0;

  function assign(m, map, rotation) {
    if (m.envMap !== map) {
      m.envMap = map;
      m.needsUpdate = true;
    }
    if (rotation) m.envMapRotation.copy(rotation);
    else m.envMapRotation.set(0, 0, 0);
  }
  function restoreMaterials() {
    finish?.restore();
    for (const [m, original] of originals)
      assign(m, original.map, original.rotation);
  }
  function applyCurrent() {
    if (!current) return;
    for (const m of originals.keys()) assign(m, current.texture, null);
    finish?.apply();
  }
  function register(root = scene) {
    if (!enabled || disposed) return 0;
    finish?.register(root);
    let added = 0;
    root?.traverse((o) => {
      for (const m of o.material
        ? Array.isArray(o.material)
          ? o.material
          : [o.material]
        : []) {
        if (!eligible(m) || originals.has(m)) continue;
        const original = { map: m.envMap, rotation: m.envMapRotation.clone() };
        original.onDispose = () => originals.delete(m);
        m.addEventListener("dispose", original.onDispose);
        originals.set(m, original);
        if (current) assign(m, current.texture, null);
        added++;
      }
    });
    return added;
  }
  function cancel() {
    if (face) cancellations++;
    face = 0;
    captureRevision = null;
  }
  function release() {
    restoreMaterials();
    finish?.dispose();
    finish = null;
    for (const [m, original] of originals)
      m.removeEventListener("dispose", original.onDispose);
    originals.clear();
    cube?.dispose();
    current?.dispose();
    spare?.dispose();
    generator?.dispose();
    probeMaterial?.dispose();
    probePrint?.dispose();
    cube = cubeCamera = generator = probeMaterial = probePrint = null;
    printSource = current = spare = null;
    stableSince = null;
    seenRevision = Symbol("unseen");
    committedRevision = Symbol("uncommitted");
    cancel();
  }
  function prepare() {
    finish = createReflectionFinish({ profile: finishProfile });
    cube = new THREE.WebGLCubeRenderTarget(edge, {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      generateMipmaps: false,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: true,
      stencilBuffer: false,
    });
    cube.texture.colorSpace = THREE.LinearSRGBColorSpace;
    cube.texture.name = "Staged local reflection cube";
    cubeCamera = new THREE.CubeCamera(0.05, 100, cube);
    cubeCamera.position.set(0, 1.6, 0);
    cubeCamera.coordinateSystem = renderer.coordinateSystem;
    cubeCamera.updateCoordinateSystem();
    cubeCamera.updateMatrixWorld(true);
    cubeCamera.layers.set(0);
    generator = createPMREM(renderer);
    generator.compileCubemapShader();
    register(scene);
  }
  function preparePrint() {
    const source = artwork?.fallbackTexture;
    if (!board || !source) return false;
    if (!probeMaterial) {
      // Material.copy deliberately does not copy custom compile hooks. The
      // main board's screen-space ink and wool shader never run in cube views.
      probeMaterial = new THREE.MeshPhysicalMaterial().copy(board.material);
      probeMaterial.name = "Probe-only world-UV printed felt";
      probeMaterial.normalMap = null;
      probeMaterial.roughnessMap = null;
      probeMaterial.roughness = 0.98;
      probeMaterial.transparent = false;
      probeMaterial.opacity = 1;
      probeMaterial.alphaTest = 0.001;
      probeMaterial.onBeforeCompile = THREE.Material.prototype.onBeforeCompile;
      probeMaterial.customProgramCacheKey =
        THREE.Material.prototype.customProgramCacheKey;
    }
    if (source !== printSource) {
      probePrint?.dispose();
      probePrint = source.clone();
      probePrint.name = "Probe-only sRGB board print";
      probePrint.colorSpace = THREE.SRGBColorSpace;
      probePrint.premultiplyAlpha = false;
      probePrint.needsUpdate = true;
      probeMaterial.map = probePrint;
      probeMaterial.needsUpdate = true;
      printSource = source;
    }
    return true;
  }
  function captureFace() {
    const savedTarget = renderer.getRenderTarget(),
      savedFace = renderer.getActiveCubeFace(),
      savedMip = renderer.getActiveMipmapLevel(),
      savedViewport = renderer.getViewport(new THREE.Vector4()).clone(),
      savedScissor = renderer.getScissor(new THREE.Vector4()).clone(),
      savedScissorTest = renderer.getScissorTest(),
      savedShadow = renderer.shadowMap.needsUpdate,
      savedXR = renderer.xr.enabled,
      savedBoardMaterial = board.material,
      savedBoardRender = board.onBeforeRender,
      savedToneMapping = renderer.toneMapping,
      savedAutoClear = renderer.autoClear,
      hidden = [];
    try {
      restoreMaterials();
      // Labels/HUD occupy layer1 and the cube cameras use layer0 only. Ghost
      // clay is a prepared action, not a real object in the reflected room.
      scene.traverse((o) => {
        if (!o.visible || !o.isMesh) return;
        const materials = Array.isArray(o.material) ? o.material : [o.material];
        if (
          materials.some(
            (m) => /^Chip/.test(m.name) && m.transparent && m.opacity < 1,
          )
        ) {
          hidden.push(o);
          o.visible = false;
        }
      });
      board.material = probeMaterial;
      board.onBeforeRender = THREE.Object3D.prototype.onBeforeRender;
      renderer.shadowMap.needsUpdate = false;
      renderer.xr.enabled = false;
      renderer.toneMapping = THREE.NoToneMapping;
      renderer.autoClear = false;
      renderer.setRenderTarget(cube, face);
      renderer.setViewport(0, 0, edge, edge);
      renderer.setScissorTest(false);
      renderer.clear(true, true, true);
      renderer.render(scene, cubeCamera.children[face]);
      captureDraws++;
    } finally {
      board.material = savedBoardMaterial;
      board.onBeforeRender = savedBoardRender;
      for (const o of hidden) o.visible = true;
      applyCurrent();
      renderer.shadowMap.needsUpdate = savedShadow;
      renderer.xr.enabled = savedXR;
      renderer.toneMapping = savedToneMapping;
      renderer.autoClear = savedAutoClear;
      renderer.setRenderTarget(savedTarget, savedFace, savedMip);
      renderer.setViewport(savedViewport);
      renderer.setScissor(savedScissor);
      renderer.setScissorTest(savedScissorTest);
    }
  }
  function filterCube() {
    const savedTarget = renderer.getRenderTarget(),
      savedFace = renderer.getActiveCubeFace(),
      savedMip = renderer.getActiveMipmapLevel(),
      savedViewport = renderer.getViewport(new THREE.Vector4()).clone(),
      savedScissor = renderer.getScissor(new THREE.Vector4()).clone(),
      savedScissorTest = renderer.getScissorTest(),
      savedXR = renderer.xr.enabled,
      savedAutoClear = renderer.autoClear,
      savedToneMapping = renderer.toneMapping,
      savedShadow = renderer.shadowMap.needsUpdate;
    try {
      return generator.fromCubemap(cube.texture, spare);
    } finally {
      renderer.setRenderTarget(savedTarget, savedFace, savedMip);
      renderer.setViewport(savedViewport);
      renderer.setScissor(savedScissor);
      renderer.setScissorTest(savedScissorTest);
      renderer.xr.enabled = savedXR;
      renderer.autoClear = savedAutoClear;
      renderer.toneMapping = savedToneMapping;
      renderer.shadowMap.needsUpdate = savedShadow;
    }
  }
  function metrics() {
    const image = probePrint?.image;
    return {
      enabled,
      finishProfile: current ? finishProfile : "current",
      supported,
      state,
      size: cube ? edge : 0,
      faces: face,
      commits,
      cancellations,
      captureDraws,
      materials: originals.size,
      revision:
        typeof committedRevision === "symbol" ? null : committedRevision,
      error,
      // Conservative texture allowance includes cube/depth, two filtered
      // images, PMREM workspace and the independently uploaded board print.
      estimatedBytes: cube
        ? edge * edge * 6 * 12 +
          [current, spare].reduce(
            (sum, t) => sum + (t ? t.width * t.height * 8 : 0),
            0,
          ) +
          edge * edge * 12 * 8 +
          (image
            ? ((image.width || image.naturalWidth) *
                (image.height || image.naturalHeight) *
                4 *
                4) /
              3
            : 0)
        : 0,
    };
  }
  return {
    register,
    setEnabled(value) {
      if (disposed || enabled === Boolean(value)) return metrics();
      enabled = Boolean(value);
      error = null;
      if (!enabled) {
        release();
        state = "off";
      } else if (!supported) state = "unsupported";
      else {
        try {
          prepare();
          state = "waiting";
        } catch (e) {
          release();
          error = String(e.message || e);
          state = "error";
        }
      }
      return metrics();
    },
    update(
      _camera,
      {
        safe = false,
        revision = artwork?.mode ?? null,
        time = performance.now(),
      } = {},
    ) {
      if (!enabled || !supported || disposed || state === "error")
        return metrics();
      if (revision !== seenRevision) {
        cancel();
        stableSince = null;
        seenRevision = revision;
        register(scene);
      }
      if (!safe) {
        cancel();
        stableSince = null;
        state = current ? "ready" : "waiting";
        return metrics();
      }
      stableSince ??= time;
      if (committedRevision === revision) {
        state = "ready";
        return metrics();
      }
      if (time - stableSince < stableMs || !artwork?.fallbackTexture) {
        state = "waiting";
        return metrics();
      }
      try {
        if (!preparePrint()) return metrics();
        captureRevision ??= revision;
        state = "capturing";
        captureFace();
        face++;
        if (face === 6) {
          const filtered = filterCube();
          spare = current;
          current = filtered;
          committedRevision = captureRevision;
          face = 0;
          captureRevision = null;
          commits++;
          applyCurrent();
          state = "ready";
        }
      } catch (e) {
        release();
        error = String(e.message || e);
        state = "error";
      }
      return metrics();
    },
    get metrics() {
      return metrics();
    },
    dispose() {
      if (disposed) return;
      release();
      enabled = false;
      state = "off";
      disposed = true;
    },
  };
}
