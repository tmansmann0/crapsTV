import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { inflateSync } from "node:zlib";
import * as THREE from "three";
import {
  createDiceMaterial,
  diceWearIndex,
  DICE_COLORS,
} from "../src/dice-material.js";
import {
  createFeltSurfaceSettings,
  FELT_TILE_SIZE,
} from "../src/felt-surface.js";

async function png(name) {
  const b = await readFile(
    new URL(`../public/assets/${name}.png`, import.meta.url),
  );
  const width = b.readUInt32BE(16),
    height = b.readUInt32BE(20),
    chunks = [];
  assert.equal(b[24], 8);
  assert.equal(b[25], 2, "linear RGB data");
  for (let p = 8; p < b.length;) {
    const n = b.readUInt32BE(p),
      type = b.toString("ascii", p + 4, p + 8);
    if (type === "IDAT") chunks.push(b.subarray(p + 8, p + 8 + n));
    p += n + 12;
  }
  const input = inflateSync(Buffer.concat(chunks)),
    stride = width * 3;
  const pixels = Buffer.alloc(stride * height);
  const paeth = (a, b, c) => {
    const p = a + b - c,
      x = Math.abs(p - a),
      y = Math.abs(p - b),
      z = Math.abs(p - c);
    return x <= y && x <= z ? a : y <= z ? b : c;
  };
  for (let y = 0; y < height; y++) {
    const filter = input[y * (stride + 1)];
    for (let x = 0; x < stride; x++) {
      const i = y * stride + x,
        a = x >= 3 ? pixels[i - 3] : 0,
        b = y ? pixels[i - stride] : 0,
        c = y && x >= 3 ? pixels[i - stride - 3] : 0;
      pixels[i] =
        (input[y * (stride + 1) + 1 + x] +
          [0, a, b, Math.floor((a + b) / 2), paeth(a, b, c)][filter]) &
        255;
    }
  }
  return { width, height, pixels };
}

test("selected dice handling scuffs preserve polished colors, pip separation and translucent behavior", () => {
  const n = new THREE.Texture(),
    r = new THREE.Texture();
  for (const color of Object.keys(DICE_COLORS))
    for (const finish of ["solid", "translucent"]) {
      const m = createDiceMaterial({ color, finish }, n, r);
      assert.equal(m.name, "DiceBody");
      assert.equal(
        m.color.getHexString(),
        new THREE.Color(DICE_COLORS[color]).getHexString(),
      );
      assert.equal(m.normalMap, n);
      assert.equal(m.clearcoatNormalMap, n);
      assert.equal(m.roughnessMap, r);
      assert.equal(m.transmission, finish === "translucent" ? 0.82 : 0);
      assert.equal(m.opacity, 1);
      assert.equal(m.depthWrite, true);
      assert.equal(m.roughness, finish === "translucent" ? 0.5 : 1);
      assert.equal(
        m.normalScale.x,
        (finish === "translucent" ? 0.3 : 0.42) * 2.2,
      );
      assert.equal(m.clearcoatNormalScale.x, 0.26 * 2);
      assert.equal(m.userData.surfaceProfile, "refined");
      assert(
        m.clearcoatNormalScale.x > 0 &&
          m.clearcoatNormalScale.x < m.normalScale.x,
      );
      m.dispose();
    }
  const fallback = createDiceMaterial(
    { color: "blue", finish: "translucent" },
    n,
    r,
    true,
  );
  assert.equal(fallback.transmission, 0);
  assert.equal(fallback.opacity, 0.65);
  assert.equal(fallback.depthWrite, false);
  assert.equal(fallback.clearcoatNormalMap, null);
  assert.notEqual(diceWearIndex("player", 0), diceWearIndex("player", 1));
});

test("baked normals remain valid, bounded in memory, unique and aligned with three scratch roughness variants", async () => {
  const metadata = JSON.parse(
    await readFile(
      new URL("../public/assets/surface-detail-metadata.json", import.meta.url),
    ),
  );
  const unique = new Set();
  for (const [name, data] of Object.entries(metadata.maps)) {
    const { width, height, pixels } = await png(name);
    assert.equal(width, data.width);
    assert.equal(height, data.height);
    assert(width <= 1024 && height <= 1024);
    assert.equal(
      createHash("sha256")
        .update(
          await readFile(
            new URL(`../public/assets/${name}.png`, import.meta.url),
          ),
        )
        .digest("hex"),
      data.sha256,
    );
    if (name.includes("wear") || name === "felt-normal") {
      let relief = 0;
      for (let i = 0; i < pixels.length; i += 3) {
        const x = (pixels[i] / 255) * 2 - 1,
          y = (pixels[i + 1] / 255) * 2 - 1,
          z = (pixels[i + 2] / 255) * 2 - 1;
        assert(Math.abs(Math.hypot(x, y, z) - 1) < 0.014);
        assert(z > (name === "felt-normal" ? 0.7 : 0.9));
        relief += Math.abs(x) + Math.abs(y);
      }
      assert(
        relief / (width * height) > 0.01,
        "tangible fine relief instead of quantized flat normals",
      );
      if (name.includes("wear")) unique.add(data.sha256);
    } else {
      for (let i = 0; i < pixels.length; i += 3) {
        assert.equal(pixels[i], pixels[i + 1]);
        assert.equal(pixels[i], pixels[i + 2]);
      }
    }
  }
  assert.equal(unique.size, 3);
  assert.equal(
    metadata.maps["dice-roughness"].sha256,
    metadata.maps["dice-roughness-1"].sha256,
  );
  for (let i = 1; i <= 3; i++) {
    const r = metadata.maps[`dice-roughness-${i}`];
    assert(r.min >= 0.2 && r.max <= 0.47);
    assert(r.standardDeviation > 0.015);
  }
  for (const [path, hash] of Object.entries(metadata.preservedSha256))
    assert.equal(
      createHash("sha256")
        .update(await readFile(new URL("../" + path, import.meta.url)))
        .digest("hex"),
      hash,
      "dice model and true pip cavities unchanged",
    );
});

test("felt provides continuous fine relief with grazing sheen, no displacement, and a fixed physical tile", async () => {
  const a = createFeltSurfaceSettings(),
    b = createFeltSurfaceSettings();
  assert.equal(FELT_TILE_SIZE, 0.46);
  assert.equal(a.clearcoat, 0);
  assert.equal(a.roughness, 1);
  assert.equal(a.sheen, 0.28);
  assert.equal(a.displacementMap, undefined);
  assert.notEqual(a.normalScale, b.normalScale);
  const { width, height, pixels } = await png("felt-normal");
  let seam = 0,
    interior = 0,
    count = 0;
  for (let y = 0; y < height; y++)
    for (let c = 0; c < 2; c++) {
      seam += Math.abs(
        pixels[y * width * 3 + c] - pixels[(y * width + width - 1) * 3 + c],
      );
      for (let x = 1; x < width; x++) {
        interior += Math.abs(
          pixels[(y * width + x) * 3 + c] - pixels[(y * width + x - 1) * 3 + c],
        );
        count++;
      }
    }
  assert(
    seam / (height * 2) < (interior / count) * 1.5,
    "repeat seam resembles adjacent fibres",
  );
});

test("dice preview opt-out and later appearance creations keep independent authored baselines", () => {
  const n1 = new THREE.Texture(),
    n2 = new THREE.Texture(),
    roughness = new THREE.Texture();
  const raw = createDiceMaterial(
    { color: "red", finish: "solid" },
    n1,
    roughness,
    false,
    { surfaceProfile: false },
  );
  const first = createDiceMaterial(
    { color: "red", finish: "solid" },
    n1,
    roughness,
  );
  const later = createDiceMaterial(
    { color: "blue", finish: "translucent" },
    n2,
    roughness,
  );
  assert.equal(raw.normalScale.x, 0.42);
  assert.equal(raw.clearcoatNormalScale.x, 0.26);
  assert.equal(raw.userData.surfaceProfile, undefined);
  assert.equal(first.normalScale.x, 0.42 * 2.2);
  assert.equal(later.normalScale.x, 0.3 * 2.2);
  assert.equal(first.normalMap, n1);
  assert.equal(later.normalMap, n2);
  assert.equal(later.transmission, 0.82);
  assert.equal(
    later.color.getHexString(),
    new THREE.Color(DICE_COLORS.blue).getHexString(),
  );
  const shader = {
    uniforms: {},
    vertexShader: THREE.ShaderLib.physical.vertexShader,
    fragmentShader: THREE.ShaderLib.physical.fragmentShader,
  };
  later.onBeforeCompile(shader, {});
  assert.equal(shader.uniforms.lookRoughnessContrast.value, 1.5);
  for (const m of [raw, first, later]) m.dispose();
});
