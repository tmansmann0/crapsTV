import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
async function model(name) {
  const bytes = await readFile(
    new URL(`../public/assets/${name}`, import.meta.url),
  );
  assert.equal(bytes.toString("ascii", 0, 4), "glTF");
  assert.equal(bytes.toString("ascii", 16, 20), "JSON");
  return JSON.parse(bytes.toString("utf8", 20, 20 + bytes.readUInt32LE(12)));
}
function triangles(gltf) {
  return gltf.meshes
    .flatMap((m) => m.primitives)
    .reduce((sum, p) => sum + gltf.accessors[p.indices].count / 3, 0);
}
test("active table keeps its geometric and draw-call budgets", async () => {
  const table = await model("table-player-rails-optimized.glb");
  assert(triangles(table) <= 38500);
  assert(table.meshes.length <= 8);
  assert(
    table.materials.some((m) => m.normalTexture),
    "rubber surface detail remains normal mapped",
  );
});
test("distant chips retain material identities within a small geometry budget", async () => {
  const chip = await model("chip-lod.glb");
  assert(triangles(chip) <= 2500);
  assert.deepEqual(
    chip.materials.map((m) => m.name).sort(),
    ["ChipBase", "ChipEngraving", "ChipInlay", "ChipMetal"].sort(),
  );
});
