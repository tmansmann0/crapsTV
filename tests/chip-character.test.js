import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import {
  chipStackPose,
  chipPoseBounds,
  chipStackBounds,
  chipPatinaParameters,
  CHIP_OFFSET_RATIO,
} from "../src/chip-character.js";
import { chipPileSpecs, wagerPileLayout } from "../src/wager-layout.js";
import { applyChipPatina } from "../src/chip-patina.js";

const specs = (seed, count = 8, diameter = 0.31) =>
  Array.from({ length: count }, (_, n) => ({
    id: `${seed}:${n}`,
    diameter,
    thicknessScale: 1.3,
    ...chipStackPose(seed, n, { diameter, thicknessScale: 1.3 }),
  }));

test("hand-placed stacks are deterministic, bounded and never rearrange earlier chips", () => {
  for (const diameter of [0.1886, 0.22, 0.23, 0.31, 0.38])
    for (let seed = 0; seed < 20; seed++) {
      const all = specs(`pile-${seed}`, 12, diameter);
      assert.deepEqual(all.slice(0, 6), specs(`pile-${seed}`, 6, diameter));
      for (const s of all) {
        assert(
          Math.hypot(s.position[0], s.position[2]) <=
            diameter * CHIP_OFFSET_RATIO + 1e-12,
        );
        assert(Math.hypot(s.rotation[0], s.rotation[2]) <= 0.01);
      }
      assert(new Set(all.map((s) => s.position[0])).size > 4);
      for (let n = 1; n < all.length; n++)
        assert(
          chipPoseBounds(all[n]).min[1] >=
            chipPoseBounds(all[n - 1]).max[1] + 0.00079,
        );
      assert(Math.abs(chipPoseBounds(all[0]).min[1]) < 1e-12);
    }
});

test("tilted cylinder bounds contain actual transformed rim and face samples", () => {
  for (const spec of specs("rim-proof", 12)) {
    const bounds = chipPoseBounds(spec);
    const q = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(...spec.rotation),
    );
    const radius = spec.diameter / 2,
      half = (0.13 * spec.diameter * spec.thicknessScale) / 2;
    for (const y of [-half, half])
      for (let i = 0; i < 128; i++) {
        const p = new THREE.Vector3(
          Math.cos((i / 128) * Math.PI * 2) * radius,
          y,
          Math.sin((i / 128) * Math.PI * 2) * radius,
        )
          .applyQuaternion(q)
          .add(new THREE.Vector3(...spec.position));
        for (let axis = 0; axis < 3; axis++)
          assert(
            p.getComponent(axis) >= bounds.min[axis] - 1e-12 &&
              p.getComponent(axis) <= bounds.max[axis] + 1e-12,
          );
        assert(Math.hypot(p.x, p.z) <= bounds.radius + 1e-12);
      }
  }
});

test("pile collider and camera bounds share the exact imperfect visible specs", () => {
  const bet = { id: "wear-bet", type: "pass", amount: 777777 };
  const state = {
    config: { mode: "craps" },
    players: [{ id: "p", seat: 3, bets: [bet] }],
  };
  const pile = wagerPileLayout({ playerId: "p", bet }, state);
  const chips = chipPileSpecs(bet.amount, {
    diameter: pile.diameter,
    seed: bet.id,
  });
  const b = chipStackBounds(chips);
  assert.equal(pile.height, b.height);
  assert.equal(pile.radius, b.radius);
  assert.deepEqual(
    pile.bounds.max,
    b.max.map((v, i) => v + pile.basePosition[i]),
  );
  assert(pile.height > 0.13 * pile.diameter * 1.3 * chips.length);
});

test("patina identity depends on chip ID, independent of motion or packing", () => {
  const s = {
    id: "bank:player:2:4",
    wear: 2,
    denomination: 500,
    position: [0, 0, 0],
  };
  assert.deepEqual(
    chipPatinaParameters(s, 0),
    chipPatinaParameters({ ...s, position: [5, 2, -3] }, 99),
  );
  assert.notDeepEqual(
    chipPatinaParameters(s),
    chipPatinaParameters({ ...s, id: "bank:player:2:5" }),
  );
  for (const v of chipPatinaParameters(s)) assert(v >= 0 && v <= 1);
});

test("patina shader uses one shared sampler, retains logo maps and has a stable cache key", () => {
  const texture = new THREE.Texture(),
    material = new THREE.MeshStandardMaterial();
  const map = new THREE.Texture(),
    normal = new THREE.Texture();
  material.map = map;
  material.normalMap = normal;
  applyChipPatina(material, texture, 0.42);
  const shader = {
    uniforms: {},
    vertexShader: "#include <common>\n#include <uv_vertex>",
    fragmentShader:
      "#include <common>\n#include <color_fragment>\n#include <roughnessmap_fragment>",
  };
  material.onBeforeCompile(shader, {});
  assert.equal(shader.uniforms.chipPatinaMap.value, texture);
  assert.equal(shader.uniforms.chipPatinaStrength.value, 0.42);
  assert.match(shader.vertexShader, /vChipPatina = instanceColor/);
  assert.match(shader.fragmentShader, /diffuseColor \*= vChipVertexColor/);
  assert(!shader.fragmentShader.includes("#include <color_fragment>"));
  assert.match(shader.fragmentShader, /roughnessFactor = clamp/);
  assert.match(material.customProgramCacheKey(), /chip-patina-v2$/);
  assert(
    !shader.fragmentShader.includes("chipGroove"),
    "no uniform radial dirt belt",
  );
  assert.equal(material.map, map);
  assert.equal(material.normalMap, normal);
});
