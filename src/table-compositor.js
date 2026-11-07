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
    return Promise.resolve(worldCompile);
  }
  function render(world, worldCamera) {
    renderer.setRenderTarget(target);
    renderer.clear();
    if (world) renderer.render(world, worldCamera);
    if (target) {
      renderer.setRenderTarget(null);
      renderer.clear();
      renderer.render(scene, camera);
    }
  }
  return {
    resize,
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
      quad.geometry.dispose();
      material.dispose();
    },
  };
}
