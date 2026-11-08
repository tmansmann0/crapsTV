import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import {
  createLensFlares,
  findPanoramaFlareSources,
} from "../src/lens-flare.js";

function setup() {
  const camera = new THREE.PerspectiveCamera(45, 16 / 9, 0.1, 100);
  camera.updateMatrixWorld(true);
  const draws = [];
  const renderer = {
    autoClear: true,
    getCurrentViewport(viewport) {
      viewport.set(0, 0, 1920, 1080);
    },
    render(scene, renderedCamera) {
      assert.equal(this.autoClear, false, "keep the world's depth buffer");
      assert.equal(renderedCamera, camera);
      draws.push(scene);
    },
  };
  return { camera, renderer, draws, effects: createLensFlares(renderer) };
}

test("Off default bypasses the renderer and owns no flare resources", () => {
  const { effects, camera, renderer } = setup();
  renderer.getCurrentViewport = () => assert.fail("Off read the viewport");
  renderer.render = () => assert.fail("Off submitted a render");
  for (let i = 0; i < 100; i++)
    effects.render(camera, {
      sources: [{ position: new THREE.Vector3(0, 0, -5) }],
    });
  assert.equal(effects.enabled, false);
  assert.equal(effects.allocatedSources, 0);
});

test("enabled effect does not invent a source when lamps are absent or out of view", () => {
  const { effects, camera, draws } = setup();
  effects.setEnabled(true);
  for (const position of [
    new THREE.Vector3(0, 0, 5),
    new THREE.Vector3(30, 0, -5),
    new THREE.Vector3(0, 30, -5),
    new THREE.Vector3(0, 0, -101),
    new THREE.Vector3(0, 0, -0.01),
    new THREE.Vector3(NaN, 0, -5),
  ])
    effects.render(camera, { sources: [{ position }] });
  effects.render(camera);
  assert.equal(draws.length, 0);
  assert.equal(effects.allocatedSources, 0);
});

test("visible source uses native GPU occlusion, reuses resources, and preserves renderer state", () => {
  const { effects, camera, renderer, draws } = setup();
  const sources = [{ position: new THREE.Vector3(0, 0, -5) }];
  effects.setEnabled(true);
  effects.render(camera, { sources });
  assert.equal(renderer.autoClear, true);
  assert.equal(draws.length, 1);
  const scene = draws[0];
  const flare = scene.children[0];
  assert.equal(flare.isLensflare, true);
  assert.equal(typeof flare.onBeforeRender, "function");
  assert(
    flare.position.distanceTo(sources[0].position) < 0.005,
    "sample remains at the lamp within half a framebuffer pixel",
  );
  for (let i = 0; i < 100; i++) effects.render(camera, { sources });
  assert.equal(effects.allocatedSources, 1);
  assert.equal(draws.at(-1), scene);
  assert.equal(scene.children[0], flare);

  sources[0].position.x = 30;
  effects.render(camera, { sources });
  assert.equal(effects.activeSources, 0);
  assert.equal(draws.length, 101);
  assert.equal(flare.visible, false);
  effects.setEnabled(false);
  assert.equal(effects.allocatedSources, 0);
  assert.equal(scene.children.length, 0);
});

test("turning Off releases public material and re-enabling starts fresh", () => {
  const { effects, camera, draws } = setup();
  const sources = [{ position: new THREE.Vector3(0, 0, -5) }];
  effects.setEnabled(true);
  effects.render(camera, { sources });
  const oldFlare = draws[0].children[0];
  let released = 0;
  oldFlare.material.addEventListener("dispose", () => released++);
  effects.setEnabled(false);
  assert.equal(released, 1);
  effects.render(camera, { sources });
  assert.equal(draws.length, 1);
  effects.setEnabled(true);
  effects.render(camera, { sources });
  assert.notEqual(draws[1].children[0], oldFlare);
  effects.dispose();
  assert.equal(effects.enabled, false);
  assert.equal(effects.allocatedSources, 0);
});

test("empty or explicitly hidden sources stop rendering and source count stays bounded", () => {
  const { effects, camera, draws } = setup();
  const sources = Array.from({ length: 20 }, () => ({
    position: new THREE.Vector3(0, 0, -5),
  }));
  effects.setEnabled(true);
  effects.render(camera, { sources });
  assert.equal(effects.allocatedSources, 6);
  assert.equal(effects.activeSources, 6);
  effects.render(camera, {
    sources: [{ position: sources[0].position, visible: false }],
  });
  assert.equal(effects.activeSources, 0);
  effects.render(camera, {
    sources: [{ position: sources[0].position, intensity: 0 }],
  });
  effects.render(camera);
  assert.equal(draws.length, 1);
  assert(draws[0].children.every((object) => object.visible === false));
  effects.dispose();
});

test("HDR emitter discovery follows the finite shell's exact UVs and transform", () => {
  const width = 64,
    height = 32;
  const data = new Uint16Array(width * height * 4);
  const index = (21 * width + 16) * 4;
  data[index] = THREE.DataUtils.toHalfFloat(8);
  data[index + 1] = THREE.DataUtils.toHalfFloat(6);
  data[index + 2] = THREE.DataUtils.toHalfFloat(4);
  const texture = new THREE.DataTexture(
    data,
    width,
    height,
    THREE.RGBAFormat,
    THREE.HalfFloatType,
  );
  texture.flipY = false;
  const shell = new THREE.Mesh(new THREE.SphereGeometry(42));
  shell.position.set(2, 2.2, -3);
  shell.rotation.y = Math.PI / 2;
  const sources = findPanoramaFlareSources(texture, shell);
  assert.equal(sources.length, 1);
  const u = 16.5 / width,
    v = 21.5 / height;
  const radius = 42 * 0.9975;
  const expected = new THREE.Vector3(
    -radius * Math.cos(u * Math.PI * 2) * Math.sin(v * Math.PI),
    -radius * Math.cos(v * Math.PI),
    radius * Math.sin(u * Math.PI * 2) * Math.sin(v * Math.PI),
  ).applyMatrix4(shell.matrixWorld);
  assert(sources[0].position.distanceTo(expected) < 1e-9);
  assert.equal(sources[0].u, u);
  assert.equal(sources[0].v, v);
  assert.equal(sources[0].color.r, 1);
  assert.equal(sources[0].color.g, 0.75);
  assert.equal(sources[0].color.b, 0.5);
  shell.geometry.dispose();
  shell.material.dispose();
  texture.dispose();
});

test("HDR discovery merges a panorama seam lamp and rejects reflections or LDR content", () => {
  const width = 64,
    height = 32;
  const data = new Float32Array(width * height * 3).fill(0.5);
  const texture = new THREE.DataTexture(
    data,
    width,
    height,
    THREE.RGBFormat,
    THREE.FloatType,
  );
  texture.flipY = false;
  const shell = new THREE.Mesh(new THREE.SphereGeometry(42));
  assert.equal(findPanoramaFlareSources(texture, shell).length, 0);
  for (const [x, y] of [
    [0, 21],
    [63, 21],
    [32, 8],
  ]) {
    const index = (y * width + x) * 3;
    data[index] = data[index + 1] = data[index + 2] = 8;
  }
  const sources = findPanoramaFlareSources(texture, shell);
  assert.equal(sources.length, 1);
  assert(sources[0].u < 0.01 || sources[0].u > 0.99);
  assert.equal(sources[0].v, 21.5 / height);

  const flipped = new Float32Array(data.length);
  for (let y = 0; y < height; y++)
    flipped.set(
      data.subarray(y * width * 3, (y + 1) * width * 3),
      (height - 1 - y) * width * 3,
    );
  texture.image.data = flipped;
  texture.flipY = true;
  const flippedSources = findPanoramaFlareSources(texture, shell);
  assert.equal(flippedSources.length, 1);
  assert(flippedSources[0].position.distanceTo(sources[0].position) < 1e-9);
  shell.geometry.dispose();
  shell.material.dispose();
  texture.dispose();
});
