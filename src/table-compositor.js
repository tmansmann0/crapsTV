import * as THREE from "three";
import { planDisplayBuffers } from "./display-resolution.js";

/** Native-resolution WebGL UI over an independently sized linear-HDR 3D scene. */
export function createTableCompositor(renderer) {
  const gl = renderer.getContext();
  const splitSupported = !!gl.getExtension("EXT_color_buffer_float");
  const maxEdge = Math.min(
    renderer.capabilities.maxTextureSize,
    gl.getParameter(gl.MAX_RENDERBUFFER_SIZE),
  );
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 2);
  camera.position.z = 1;
  const material = new THREE.MeshBasicMaterial({
    depthTest: false,
    depthWrite: false,
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  quad.frustumCulled = false;
  scene.add(quad);
  const depthMaterial = new THREE.MeshBasicMaterial({ colorWrite: false });
  let nativeSurface = null;
  let target = null,
    plan = null;
  function resize(options) {
    plan = planDisplayBuffers({ ...options, maxEdge, splitSupported });
    renderer.setPixelRatio(plan.uiRatio);
    renderer.setSize(plan.width, plan.height, false);
    if (plan.split) {
      if (!target) {
        target = new THREE.WebGLRenderTarget(
          plan.sceneWidth,
          plan.sceneHeight,
          {
            type: THREE.HalfFloatType,
            minFilter: THREE.LinearFilter,
            magFilter: THREE.LinearFilter,
            depthBuffer: true,
            stencilBuffer: false,
          },
        );
        target.texture.colorSpace = THREE.LinearSRGBColorSpace;
        target.texture.name = "Scaled 3D scene (linear HDR)";
        material.map = target.texture;
        material.needsUpdate = true;
      }
      const samples = options.antialias
        ? Math.min(4, gl.getParameter(gl.MAX_SAMPLES))
        : 0;
      if (target.samples !== samples) {
        target.dispose();
        target.samples = samples;
      }
      target.setSize(plan.sceneWidth, plan.sceneHeight);
    } else if (target) {
      target.dispose();
      target = null;
      material.map = null;
      material.needsUpdate = true;
    }
    return plan;
  }
  function compile(world, worldCamera) {
    let worldCompile;
    try {
      renderer.setRenderTarget(target);
      worldCompile = renderer.compileAsync(world, worldCamera);
      renderer.setRenderTarget(null);
      // This single inexpensive program can change map presence on resize.
      // Do not leave an async material poll alive across that transition.
      if (target) renderer.compile(scene, camera);
    } finally {
      renderer.setRenderTarget(null);
    }
    return Promise.resolve(worldCompile).then(() => {
      // Tone mapping/output colour differs between HDR-target and screen
      // programs. Warm both the native physical material and depth variant
      // before startup's black gate opens, after async polling has settled.
      if (target) renderNativeSurface(world, worldCamera, true);
    });
  }
  function renderNativeSurface(world, worldCamera, compileOnly = false) {
    if (!nativeSurface?.visible) return;
    const background = world.background;
    const override = world.overrideMaterial;
    const matrixAutoUpdate = world.matrixWorldAutoUpdate;
    const shadowUpdate = renderer.shadowMap.needsUpdate;
    const hidden = [];
    const others = [];
    world.traverse((object) => {
      if (!object.visible || !object.isMesh || object === nativeSurface) return;
      others.push(object);
      // Preserve already-composited translucent dice and ghost chips too:
      // native felt must not paint over their visible silhouettes.
      if (object.userData.environment) {
        hidden.push(object);
        object.visible = false;
      }
    });
    world.background = null;
    world.matrixWorldAutoUpdate = false;
    renderer.shadowMap.needsUpdate = false;
    try {
      if (!compileOnly) renderer.clearDepth();
      nativeSurface.visible = false;
      world.overrideMaterial = depthMaterial;
      if (compileOnly) renderer.compile(world, worldCamera);
      else renderer.render(world, worldCamera);
      world.overrideMaterial = override;
      nativeSurface.visible = true;
      for (const object of others) object.visible = false;
      // Same material, lighting, shadow map and camera; only its framebuffer
      // changes. Ink therefore stays on the felt and behind solid pieces.
      if (compileOnly) renderer.compile(world, worldCamera);
      else renderer.render(world, worldCamera);
    } finally {
      nativeSurface.visible = true;
      for (const object of others) object.visible = true;
      for (const object of hidden) object.visible = true;
      world.background = background;
      world.overrideMaterial = override;
      world.matrixWorldAutoUpdate = matrixAutoUpdate;
      renderer.shadowMap.needsUpdate = shadowUpdate;
    }
  }
  function render(world, worldCamera) {
    renderer.setRenderTarget(target);
    renderer.clear();
    if (world) renderer.render(world, worldCamera);
    if (target) {
      renderer.setRenderTarget(null);
      renderer.clear();
      renderer.render(scene, camera);
      if (world) renderNativeSurface(world, worldCamera);
    }
  }
  return {
    resize,
    setNativeSurface(surface) {
      nativeSurface = surface;
    },
    compile,
    render,
    get plan() {
      return plan;
    },
    get splitSupported() {
      return splitSupported;
    },
    dispose() {
      target?.dispose();
      depthMaterial.dispose();
      quad.geometry.dispose();
      material.dispose();
    },
  };
}
