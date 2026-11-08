import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { createLocalReflections } from "../src/local-reflections.js";
const finishValues = (m) => ({
  roughness: m.roughness,
  clearcoat: m.clearcoat,
  clearcoatRoughness: m.clearcoatRoughness,
  envMapIntensity: m.envMapIntensity,
});

function fixture({
  supported = true,
  failRender = false,
  failFilter = false,
  finishProfile = "medium",
} = {}) {
  const scene = new THREE.Scene(),
    originalEnv = new THREE.Texture(),
    wood = new THREE.MeshPhysicalMaterial({
      name: "Hand-polished dark walnut",
      envMap: originalEnv,
      roughness: 1,
      clearcoat: 0.4,
      clearcoatRoughness: 0.3,
      envMapIntensity: 0.85,
    }),
    dice = new THREE.MeshPhysicalMaterial({
      name: "DiceBody",
      roughness: 1,
      clearcoat: 0.35,
      clearcoatRoughness: 0.2,
      envMapIntensity: 1.1,
    }),
    clay = new THREE.MeshPhysicalMaterial({ name: "ChipBase" }),
    ghost = new THREE.Mesh(
      new THREE.BoxGeometry(),
      new THREE.MeshPhysicalMaterial({
        name: "ChipBase ghost",
        transparent: true,
        opacity: 0.4,
      }),
    ),
    label = new THREE.Mesh(
      new THREE.PlaneGeometry(),
      new THREE.MeshBasicMaterial(),
    ),
    board = new THREE.Mesh(
      new THREE.PlaneGeometry(),
      new THREE.MeshPhysicalMaterial(),
    ),
    fallback = new THREE.Texture({ width: 2048, height: 1024 }),
    artwork = { mode: "classic", fallbackTexture: fallback },
    frames = [],
    filtered = [];
  let oldBoardCallbacks = 0,
    generatorCount = 0,
    generatorDisposals = 0;
  const baseline = {
    wood: finishValues(wood),
    dice: finishValues(dice),
    clay: finishValues(clay),
  };
  board.material.onBeforeCompile = () => {
    oldBoardCallbacks++;
  };
  board.onBeforeRender = () => {
    oldBoardCallbacks++;
  };
  const originalBoard = board.material,
    originalBoardRender = board.onBeforeRender;
  wood.envMapRotation.set(0.1, 0.2, 0.3);
  label.layers.set(1);
  scene.add(
    board,
    ghost,
    label,
    new THREE.Mesh(new THREE.BoxGeometry(), wood),
    new THREE.Mesh(new THREE.BoxGeometry(), dice),
    new THREE.Mesh(new THREE.BoxGeometry(), clay),
  );
  const savedTarget = { name: "main-target" },
    viewport = new THREE.Vector4(8, 9, 100, 80),
    scissor = new THREE.Vector4(2, 3, 40, 30);
  let target = savedTarget,
    face = 2,
    mip = 1,
    scissorTest = true;
  const renderer = {
    coordinateSystem: THREE.WebGLCoordinateSystem,
    capabilities: { isWebGL2: true, maxCubemapSize: 4096 },
    getContext: () => ({ getExtension: () => (supported ? {} : null) }),
    shadowMap: { needsUpdate: true },
    xr: { enabled: true },
    toneMapping: THREE.ACESFilmicToneMapping,
    autoClear: true,
    getRenderTarget: () => target,
    getActiveCubeFace: () => face,
    getActiveMipmapLevel: () => mip,
    setRenderTarget: (t, f = 0, m = 0) => {
      target = t;
      face = f;
      mip = m;
    },
    getViewport: (v) => v.copy(viewport),
    setViewport: (...args) =>
      args[0]?.isVector4 ? viewport.copy(args[0]) : viewport.set(...args),
    getScissor: (v) => v.copy(scissor),
    setScissor: (v) => scissor.copy(v),
    getScissorTest: () => scissorTest,
    setScissorTest: (value) => {
      scissorTest = value;
    },
    clear() {},
    render(s, camera) {
      assert.equal(
        wood.envMap,
        originalEnv,
        "capture never samples previous local probe",
      );
      assert.equal(dice.envMap, null);
      assert.deepEqual(
        finishValues(wood),
        baseline.wood,
        "probe captures original wood finish, avoiding material feedback",
      );
      assert.deepEqual(
        finishValues(dice),
        baseline.dice,
        "probe captures original resin finish",
      );
      assert.notEqual(board.material, originalBoard);
      assert.equal(board.material.map.colorSpace, THREE.SRGBColorSpace);
      assert.equal(board.material.map.premultiplyAlpha, false);
      assert.notEqual(
        board.material.map,
        fallback,
        "source texture stays untouched",
      );
      assert.equal(board.material.normalMap, null);
      assert.equal(
        board.onBeforeRender,
        THREE.Object3D.prototype.onBeforeRender,
      );
      assert.equal(ghost.visible, false);
      assert.equal(camera.layers.test(label.layers), false);
      assert.deepEqual(camera.parent.position.toArray(), [0, 1.6, 0]);
      assert.equal(renderer.toneMapping, THREE.NoToneMapping);
      frames.push({
        target,
        face,
        print: board.material.map,
        material: board.material,
      });
      if (typeof failRender === "function" ? failRender(frames) : failRender)
        throw Error("capture failed");
    },
  };
  const createPMREM = () => {
    generatorCount++;
    return {
      compileCubemapShader() {},
      fromCubemap(texture, reuse) {
        assert.deepEqual(
          frames.slice(-6).map(({ face }) => face),
          [0, 1, 2, 3, 4, 5],
          "only complete consecutive cubes are committed",
        );
        renderer.setRenderTarget({ name: "pmrem-private" });
        renderer.setViewport(0, 0, 7, 7);
        renderer.autoClear = false;
        renderer.xr.enabled = false;
        renderer.shadowMap.needsUpdate = false;
        if (failFilter) throw Error("filter failed");
        const out = reuse || new THREE.WebGLRenderTarget(768, 1024);
        out.texture.mapping = THREE.CubeUVReflectionMapping;
        filtered.push(out);
        return out;
      },
      dispose() {
        generatorDisposals++;
      },
    };
  };
  const control = createLocalReflections(renderer, {
    scene,
    board,
    artwork,
    createPMREM,
    finishProfile,
  });
  function restored() {
    assert.equal(board.material, originalBoard);
    assert.equal(board.onBeforeRender, originalBoardRender);
    assert.equal(ghost.visible, true);
    assert.equal(target, savedTarget);
    assert.equal(face, 2);
    assert.equal(mip, 1);
    assert.deepEqual(viewport.toArray(), [8, 9, 100, 80]);
    assert.deepEqual(scissor.toArray(), [2, 3, 40, 30]);
    assert.equal(scissorTest, true);
    assert.equal(renderer.xr.enabled, true);
    assert.equal(renderer.shadowMap.needsUpdate, true);
    assert.equal(renderer.toneMapping, THREE.ACESFilmicToneMapping);
    assert.equal(renderer.autoClear, true);
    assert.equal(oldBoardCallbacks, 0);
  }
  function update(time, revision = 1, safe = true) {
    const result = control.update(null, { time, revision, safe });
    restored();
    return result;
  }
  return {
    control,
    update,
    restored,
    frames,
    filtered,
    wood,
    dice,
    clay,
    ghost,
    originalEnv,
    fallback,
    artwork,
    scene,
    baseline,
    get generators() {
      return generatorCount;
    },
    get generatorDisposals() {
      return generatorDisposals;
    },
  };
}

test("off/default and unsupported reflection mode allocate no resources or draws", () => {
  for (const supported of [true, false]) {
    const f = fixture({ supported });
    assert.equal(f.control.metrics.state, "off");
    assert.equal(f.update(1000).estimatedBytes, 0);
    assert.equal(f.generators, 0);
    if (!supported) {
      assert.equal(f.control.setEnabled(true).state, "unsupported");
      assert.equal(f.update(2000).estimatedBytes, 0);
      assert.equal(f.generators, 0);
    }
    f.control.dispose();
  }
});

test("six staged safe views atomically publish a cached probe without touching native artwork", () => {
  const f = fixture();
  f.control.setEnabled(true);
  assert.equal(f.update(0).state, "waiting");
  assert.equal(f.update(599).captureDraws, 0);
  assert.deepEqual(finishValues(f.wood), f.baseline.wood);
  assert.deepEqual(finishValues(f.dice), f.baseline.dice);
  for (let face = 0; face < 6; face++) {
    const result = f.update(600 + face * 20);
    assert.equal(result.captureDraws, face + 1);
    assert.equal(
      f.wood.envMap,
      face < 5 ? f.originalEnv : f.filtered[0].texture,
    );
    if (face < 5) {
      assert.deepEqual(
        finishValues(f.wood),
        f.baseline.wood,
        "partial cubes cannot enable a new finish",
      );
      assert.deepEqual(finishValues(f.dice), f.baseline.dice);
    }
  }
  assert.equal(f.control.metrics.commits, 1);
  assert.equal(f.control.metrics.hasProbe, true);
  assert.deepEqual(
    f.frames.map((f) => f.face),
    [0, 1, 2, 3, 4, 5],
  );
  assert.equal(f.dice.envMap, f.filtered[0].texture);
  assert.equal(f.clay.envMap, null, "clay keeps global casino lighting");
  assert.deepEqual(f.wood.envMapRotation.toArray(), [0, 0, 0, "XYZ"]);
  assert.equal(f.fallback.colorSpace, THREE.NoColorSpace);
  assert.deepEqual(finishValues(f.wood), {
    roughness: 0.7,
    clearcoat: 0.6,
    clearcoatRoughness: 0.18,
    envMapIntensity: 0.85 * 1.25,
  });
  assert.deepEqual(finishValues(f.dice), {
    roughness: 0.7,
    clearcoat: 0.65,
    clearcoatRoughness: 0.11,
    envMapIntensity: 1.1 * 1.15,
  });
  assert.deepEqual(finishValues(f.clay), f.baseline.clay);
  f.update(5000);
  assert.equal(f.frames.length, 6, "camera frames alone never recapture");
  f.control.dispose();
});

test("unsafe movement and changed revisions discard partial cubes, retaining only complete previous probes", () => {
  const f = fixture();
  f.control.setEnabled(true);
  f.update(0);
  f.update(600);
  f.update(620);
  assert.equal(f.update(640, 1, false).faces, 0);
  assert.equal(f.control.metrics.commits, 0);
  f.update(1000);
  f.update(1600);
  f.update(1620, 2);
  assert.equal(f.control.metrics.faces, 0);
  for (let i = 0; i < 6; i++) f.update(2220 + i * 20, 2);
  assert.equal(f.control.metrics.commits, 1);
  assert.equal(f.control.metrics.cancellations, 2);
  const previous = f.wood.envMap;
  f.update(3000, 3);
  f.update(3600, 3);
  f.update(3620, 3, false);
  assert.equal(f.wood.envMap, previous);
  assert.equal(
    f.wood.roughness,
    0.7,
    "previous complete probe keeps its finish after partial recapture cancellation",
  );
  f.control.dispose();
});

test("disable restores original maps/rotation, removes all targets and can enable cleanly again", () => {
  const f = fixture();
  f.control.setEnabled(true);
  f.update(0);
  for (let i = 0; i < 6; i++) f.update(600 + i * 20);
  let cubeDisposals = 0,
    mapDisposals = 0,
    printDisposals = 0,
    materialDisposals = 0;
  f.frames[0].target.addEventListener("dispose", () => cubeDisposals++);
  f.filtered[0].addEventListener("dispose", () => mapDisposals++);
  f.frames[0].print.addEventListener("dispose", () => printDisposals++);
  f.frames[0].material.addEventListener("dispose", () => materialDisposals++);
  const version = f.wood.version;
  const off = f.control.setEnabled(false);
  assert.equal(off.estimatedBytes, 0);
  assert.equal(off.hasProbe, false);
  assert.equal(off.materials, 0);
  assert.equal(f.wood.envMap, f.originalEnv);
  assert.deepEqual(finishValues(f.wood), f.baseline.wood);
  assert.deepEqual(finishValues(f.dice), f.baseline.dice);
  assert.deepEqual(f.wood.envMapRotation.toArray(), [0.1, 0.2, 0.3, "XYZ"]);
  assert(f.wood.version > version, "restored shaders are invalidated");
  assert.deepEqual(
    [cubeDisposals, mapDisposals, printDisposals, materialDisposals],
    [1, 1, 1, 1],
  );
  assert.equal(f.generatorDisposals, 1);
  f.update(10000);
  assert.equal(f.frames.length, 6);
  f.control.setEnabled(true);
  assert.equal(f.generators, 2);
  assert.equal(f.control.metrics.commits, 1);
  assert.equal(
    f.control.metrics.hasProbe,
    false,
    "a past commit cannot qualify a new cold probe",
  );
  f.control.dispose();
  f.control.dispose();
  assert.equal(f.generatorDisposals, 2);
});

test("late materials register explicitly, use the complete probe, and external disposal unregisters them", () => {
  const f = fixture();
  f.control.setEnabled(true);
  f.update(0);
  for (let i = 0; i < 6; i++) f.update(600 + i * 20);
  const late = new THREE.MeshPhysicalMaterial({ name: "DiceBody" }),
    root = new THREE.Group();
  const lateBaseline = finishValues(late);
  root.add(new THREE.Mesh(new THREE.BoxGeometry(), late));
  assert.equal(f.control.register(root), 1);
  assert.equal(late.envMap, f.filtered[0].texture);
  assert.equal(late.roughness, lateBaseline.roughness * 0.7);
  const count = f.control.metrics.materials;
  late.dispose();
  assert.equal(f.control.metrics.materials, count - 1);
  f.control.dispose();
});

test("late resin finish restores on Off and reference Current never changes original scalars", () => {
  for (const finishProfile of ["medium", "current"]) {
    const f = fixture({ finishProfile });
    f.control.setEnabled(true);
    f.update(0);
    for (let i = 0; i < 6; i++) f.update(600 + i * 20);
    const late = new THREE.MeshPhysicalMaterial({
      name: "DiceBody",
      roughness: 0.8,
      clearcoat: 0.2,
      clearcoatRoughness: 0.3,
      envMapIntensity: 0.9,
    });
    const baseline = finishValues(late),
      root = new THREE.Group();
    root.add(new THREE.Mesh(new THREE.BoxGeometry(), late));
    f.control.register(root);
    if (finishProfile === "current") {
      assert.deepEqual(finishValues(f.wood), f.baseline.wood);
      assert.deepEqual(finishValues(f.dice), f.baseline.dice);
      assert.deepEqual(finishValues(late), baseline);
    } else assert.equal(late.roughness, 0.8 * 0.7);
    f.control.setEnabled(false);
    assert.deepEqual(finishValues(late), baseline);
    assert.deepEqual(finishValues(f.wood), f.baseline.wood);
    assert.deepEqual(finishValues(f.dice), f.baseline.dice);
    f.control.dispose();
  }
});

test("capture and filter failures restore renderer/material state before releasing all resources", () => {
  for (const mode of ["failRender", "failFilter"]) {
    const f = fixture({ [mode]: true });
    f.control.setEnabled(true);
    f.update(0);
    for (let i = 0; i < 6 && f.control.metrics.state !== "error"; i++)
      f.update(600 + i * 20);
    assert.equal(f.control.metrics.state, "error");
    assert.equal(f.control.metrics.estimatedBytes, 0);
    assert.match(f.control.metrics.error, /failed/);
    assert.equal(f.wood.envMap, f.originalEnv);
    assert.equal(f.dice.envMap, null);
    assert.deepEqual(finishValues(f.wood), f.baseline.wood);
    assert.deepEqual(finishValues(f.dice), f.baseline.dice);
    assert.equal(f.generatorDisposals, 1);
    f.control.dispose();
  }
});

test("failure during a later recapture removes the completed probe and restores its richer finish exactly", () => {
  const f = fixture({ failRender: (frames) => frames.length > 6 });
  f.control.setEnabled(true);
  f.update(0);
  for (let i = 0; i < 6; i++) f.update(600 + i * 20);
  assert.equal(f.control.metrics.commits, 1);
  assert.equal(f.wood.roughness, 0.7);
  f.update(1000, 2);
  const failed = f.update(1600, 2);
  assert.equal(failed.state, "error");
  assert.equal(failed.estimatedBytes, 0);
  assert.equal(failed.finishProfile, "current");
  assert.deepEqual(finishValues(f.wood), f.baseline.wood);
  assert.deepEqual(finishValues(f.dice), f.baseline.dice);
  assert.equal(f.wood.envMap, f.originalEnv);
  assert.equal(f.dice.envMap, null);
  f.control.dispose();
});
