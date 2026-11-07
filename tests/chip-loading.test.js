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
        assert.deepEqual(material.normalScale.toArray(), [strength, strength]);
        assert.equal(material.userData.chipPatina, true);
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
