import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { createChipFactory } from "../src/chip-rendering.js";
const renderer = { capabilities: { getMaxAnisotropy: () => 4 } };
const later = () => {
  let resolve;
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
};
function fixture() {
  const counts = new Map();
  function track(value) {
    counts.set(value, 0);
    value.addEventListener("dispose", () =>
      counts.set(value, counts.get(value) + 1),
    );
    return value;
  }
  const texture = () => track(new THREE.Texture({ width: 4, height: 4 }));
  function model(missing) {
    const scene = new THREE.Group();
    for (const name of [
      "ChipBase",
      "ChipInlay",
      "ChipEngraving",
      "ChipMetal",
    ]) {
      const material = track(new THREE.MeshStandardMaterial());
      material.name = name;
      for (const key of ["map", "normalMap", "roughnessMap"])
        if (missing !== `${name}.${key}`) material[key] = texture();
      scene.add(new THREE.Mesh(track(new THREE.BoxGeometry()), material));
    }
    return { scene };
  }
  const allDisposed = () => {
    assert(counts.size > 10);
    for (const [value, count] of counts)
      assert.equal(count, 1, value.type || "texture");
  };
  return { counts, texture, model, allDisposed };
}
for (const key of ["map", "normalMap", "roughnessMap"])
  test(`missing detailed engraving ${key} rejects startup and releases late successful resources`, async () => {
    const f = fixture(),
      high = f.model("ChipEngraving." + key),
      low = f.model(),
      late = later();
    let settled = false;
    const promise = createChipFactory(renderer, {
      resolveAsset: (n) => n,
      loadModel: async (n) => (n === "chip-logo.glb" ? high : low),
      loadTexture: (n) =>
        n === "chip-normal-3.png" ? late.promise : Promise.resolve(f.texture()),
    });
    promise.catch(() => {
      settled = true;
    });
    await new Promise(setImmediate);
    assert.equal(
      settled,
      false,
      "wait for late successful wear map before cleanup",
    );
    for (const count of f.counts.values()) assert.equal(count, 0);
    late.resolve(f.texture());
    await assert.rejects(promise, new RegExp("ChipEngraving\\." + key));
    f.allDisposed();
  });
test("failed required model releases a successful late LOD and all successful wear maps", async () => {
  const f = fixture(),
    late = later(),
    failure = new Error("high model offline");
  const promise = createChipFactory(renderer, {
    resolveAsset: (n) => n,
    loadModel: (n) =>
      n === "chip-logo.glb" ? Promise.reject(failure) : late.promise,
    loadTexture: async () => f.texture(),
  });
  await new Promise(setImmediate);
  late.resolve(f.model());
  await assert.rejects(promise, (error) => error === failure);
  f.allDisposed();
});
test("failed wear map releases detailed/optional models and other late wear maps", async () => {
  const f = fixture(),
    high = f.model(),
    low = f.model(),
    late = later(),
    failure = new Error("wear map offline");
  const promise = createChipFactory(renderer, {
    resolveAsset: (n) => n,
    loadModel: async (n) => (n === "chip-logo.glb" ? high : low),
    loadTexture: (n) =>
      n === "chip-normal-1.png"
        ? Promise.reject(failure)
        : n === "chip-roughness-3.png"
          ? late.promise
          : Promise.resolve(f.texture()),
  });
  await new Promise(setImmediate);
  late.resolve(f.texture());
  await assert.rejects(promise, (error) => error === failure);
  f.allDisposed();
});
test("optional LOD failure retains valid detailed chips and disposal is idempotent", async () => {
  const f = fixture(),
    high = f.model();
  const factory = await createChipFactory(renderer, {
    resolveAsset: (n) => n,
    loadModel: (n) =>
      n === "chip-logo.glb"
        ? Promise.resolve(high)
        : Promise.reject(new Error("optional LOD offline")),
    loadTexture: async () => f.texture(),
  });
  const chip = factory.create({ denomination: 500 });
  assert.equal(chip.children.length, 4);
  assert(
    chip.children.find((o) => o.material.name === "ChipEngraving").material
      .normalMap,
  );
  const batch = factory.createBatch([{ position: [0, 0, 0] }]);
  assert(batch.userData.chipBatch);
  factory.dispose();
  factory.dispose();
  f.allDisposed();
});
test("missing denomination albedo also fails the critical asset gate", async () => {
  const f = fixture(),
    high = f.model("ChipBase.map");
  await assert.rejects(
    createChipFactory(renderer, {
      resolveAsset: (n) => n,
      loadModel: async (n) => (n === "chip-logo.glb" ? high : null),
      loadTexture: async () => f.texture(),
    }),
    /ChipBase\.map/,
  );
  f.allDisposed();
});
test("missing shared patina atlas fails the asset gate and cleans up all model/maps", async () => {
  const f = fixture(),
    high = f.model(),
    low = f.model();
  await assert.rejects(
    createChipFactory(renderer, {
      resolveAsset: (n) => n,
      loadModel: async (n) => (n === "chip-logo.glb" ? high : low),
      loadTexture: async (n) => {
        if (n === "chip-patina.png") throw new Error("patina offline");
        return f.texture();
      },
    }),
    /patina offline/,
  );
  f.allDisposed();
});

test("scuff relief, roughness and engraving survive both instanced chip detail levels", async () => {
  const f = fixture(),
    high = f.model(),
    low = f.model(),
    maps = new Map();
  const factory = await createChipFactory(renderer, {
    resolveAsset: (n) => n,
    loadModel: async (n) => (n === "chip-logo.glb" ? high : low),
    loadTexture: async (n) => {
      const texture = f.texture();
      maps.set(n, texture);
      return texture;
    },
  });
  const batch = factory.createBatch(
    [0, 1, 2].map((wear) => ({
      wear,
      position: [wear, 0, -6],
      denomination: 500,
    })),
  );
  const camera = new THREE.PerspectiveCamera(45, 16 / 9, 0.1, 500);
  camera.updateMatrixWorld(true);
  const engraving = high.scene.children.find(
    (o) => o.material.name === "ChipEngraving",
  ).material;
  for (const detail of ["full", "optimized"]) {
    factory.updateLOD(batch, camera, 2160, detail);
    const active = batch.children.filter((mesh) => mesh.visible && mesh.count);
    for (const name of ["ChipBase", "ChipInlay"]) {
      const clay = active.filter((mesh) => mesh.material.name === name);
      assert.equal(clay.length, 3);
      for (const [wear, strength] of [0.3, 0.38, 0.44].entries()) {
        const material = clay.find(
          (mesh) =>
            mesh.material.normalMap === maps.get(`chip-normal-${wear + 1}.png`),
        )?.material;
        assert(material, `${detail}: ${name} retains wear pattern ${wear + 1}`);
        assert.equal(
          material.roughnessMap,
          maps.get(`chip-roughness-${wear + 1}.png`),
        );
        assert.deepEqual(material.normalScale.toArray(), [
          strength * 2.3,
          strength * 2.3,
        ]);
        assert.equal(material.userData.chipPatina, true);
        assert.equal(material.userData.surfaceProfile, "refined");
        assert.equal(material.scratchMap, maps.get("chip-scratch-study.png"));
      }
    }
    const stamp = active.find(
      (mesh) => mesh.material.name === "ChipEngraving",
    ).material;
    assert.equal(
      stamp.normalMap,
      engraving.normalMap,
      "logo relief stays alongside the clay scuffs",
    );
    assert.equal(stamp.userData.chipPatina, true);
  }
  factory.dispose();
  f.allDisposed();
});

test("required scratch atlas failure waits for late resources and releases the entire gate", async () => {
  const f = fixture(),
    high = f.model(),
    low = f.model(),
    late = later();
  let settled = false;
  const promise = createChipFactory(renderer, {
    resolveAsset: (n) => n,
    loadModel: async (n) => (n === "chip-logo.glb" ? high : low),
    loadTexture: (n) =>
      n === "chip-scratch-study.png"
        ? Promise.reject(new Error("scratch atlas offline"))
        : n === "chip-normal-3.png"
          ? late.promise
          : Promise.resolve(f.texture()),
  });
  promise.catch(() => {
    settled = true;
  });
  await new Promise(setImmediate);
  assert.equal(settled, false);
  for (const count of f.counts.values()) assert.equal(count, 0);
  late.resolve(f.texture());
  await assert.rejects(promise, /scratch atlas offline/);
  f.allDisposed();
});

test("lazy denomination, wear and ghost caches receive selected scoring without new per-chip programs", async () => {
  const f = fixture(),
    maps = new Map();
  const factory = await createChipFactory(renderer, {
    resolveAsset: (n) => n,
    loadModel: async () => f.model(),
    loadTexture: async (n) => {
      const t = f.texture();
      maps.set(n, t);
      return t;
    },
  });
  const first = factory.create({ denomination: 500, wear: 0 });
  const again = factory.create({ denomination: 500, wear: 0 });
  assert.equal(first.children[0].material, again.children[0].material);
  const ghost = factory.create({
    denomination: 100000,
    wear: 2,
    opacity: 0.35,
  });
  const clay = ghost.children.find(
    (m) => m.material.name === "ChipBase",
  ).material;
  assert.equal(clay.opacity, 0.35);
  assert.equal(clay.depthWrite, false);
  assert.deepEqual(clay.normalScale.toArray(), [0.44 * 2.3, 0.44 * 2.3]);
  assert.equal(clay.scratchMap, maps.get("chip-scratch-study.png"));
  assert.equal(
    clay.customProgramCacheKey(),
    first.children
      .find((m) => m.material.name === "ChipBase")
      .material.customProgramCacheKey(),
  );
  const shader = {
    uniforms: {},
    vertexShader: THREE.ShaderLib.standard.vertexShader,
    fragmentShader: THREE.ShaderLib.standard.fragmentShader,
  };
  clay.onBeforeCompile(shader, {});
  assert.equal(shader.uniforms.chipScratchRelief.value, 1);
  assert.equal(shader.uniforms.chipScratchAlbedo.value, 0.4);
  const specs = [100, 500, 2500, 10000, 50000, 100000].flatMap(
    (denomination, d) =>
      [0, 1, 2].flatMap((wear) =>
        [1, 0.35].map((opacity) => ({
          denomination,
          wear,
          opacity,
          position: [d, 0, -8],
        })),
      ),
  );
  const batch = factory.createBatch(specs),
    camera = new THREE.PerspectiveCamera(45, 16 / 9, 0.1, 500);
  camera.updateMatrixWorld(true);
  let ids;
  for (const detail of ["full", "optimized"]) {
    factory.updateLOD(batch, camera, 2160, detail);
    const active = batch.children
      .filter((m) => m.visible && m.count)
      .map((m) => m.material);
    const current = [...new Set(active.map((m) => m.uuid))].sort();
    if (ids) assert.deepEqual(current, ids);
    ids = current;
    for (const material of active.filter((m) =>
      /^Chip(Base|Inlay|Engraving)/.test(m.name),
    )) {
      assert.equal(material.userData.surfaceProfile, "refined");
      assert.equal(material.scratchMap, maps.get("chip-scratch-study.png"));
    }
  }
  factory.dispose();
  f.allDisposed();
});

test("study opt-out keeps authored material baselines and skips the production scratch request", async () => {
  const f = fixture(),
    requests = [];
  const factory = await createChipFactory(renderer, {
    surfaceProfile: false,
    resolveAsset: (n) => n,
    loadModel: async () => f.model(),
    loadTexture: async (n) => {
      requests.push(n);
      return f.texture();
    },
  });
  const chip = factory.create({ denomination: 500, wear: 0 });
  const clay = chip.children.find(
    (m) => m.material.name === "ChipBase",
  ).material;
  assert.deepEqual(clay.normalScale.toArray(), [0.3, 0.3]);
  assert.equal(clay.userData.surfaceProfile, undefined);
  assert(!requests.includes("chip-scratch-study.png"));
  factory.dispose();
  f.allDisposed();
});
