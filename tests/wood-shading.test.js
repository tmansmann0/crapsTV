import test from "node:test";
import assert from "node:assert/strict";
import { exportedWood, woodGeometrySignature } from "./helpers/wood-export.mjs";

const triangles = exportedWood();
const flat = triangles.filter(
  (t) => t.area >= 1e-6 && Math.abs(t.normal.y) > 0.999,
);
const cosine = Math.cos((0.1 * Math.PI) / 180);

test("all substantial horizontal wood surfaces have planar shading normals", () => {
  assert.ok(
    flat.length >= 1500,
    "inspect shelf, tray and horizontal furniture surfaces",
  );
  for (const t of flat)
    for (const n of t.normals)
      assert.ok(
        n.dot(t.normal) >= cosine,
        `flat wood at ${t.center.toArray()} has a misleading shading normal`,
      );
});

test("all four broad shelf corners retain the correct top-plane lighting", () => {
  const counts = new Map();
  for (const t of flat.filter((t) =>
    t.points.every((p) => p.y >= 0.6 && p.y <= 0.62),
  )) {
    const key =
      (t.center.x < 0 ? "left" : "right") + (t.center.z < 0 ? "Back" : "Front");
    counts.set(key, (counts.get(key) || 0) + 1);
    for (const n of t.normals) assert.ok(n.dot(t.normal) >= cosine, key);
  }
  assert.equal(counts.size, 4);
  for (const [name, count] of counts)
    assert.ok(count >= 10, `actual exported deck triangles at ${name}`);
});

test("curved outer apron corners retain continuous smooth shading", () => {
  const vertices = new Map(),
    corners = new Set();
  let count = 0;
  for (const t of triangles) {
    if (
      t.area < 1e-6 ||
      Math.abs(t.normal.y) > 0.01 ||
      t.center.y < -0.12 ||
      t.center.y > 0.38
    )
      continue;
    const dx = Math.abs(t.center.x) - 5.65,
      dz = Math.abs(t.center.z - 0.5) - 2.45;
    if (dx <= 0 || dz <= 0 || Math.abs(Math.hypot(dx, dz) - 1.475) > 0.015)
      continue;
    corners.add(`${Math.sign(t.center.x)}:${Math.sign(t.center.z - 0.5)}`);
    count++;
    for (let i = 0; i < 3; i++) {
      assert.ok(
        t.normals[i].dot(t.normal) > Math.cos((10 * Math.PI) / 180),
        "genuine rounded wall retains a smooth normal",
      );
      const key = t.points[i]
        .toArray()
        .map((v) => v.toFixed(5))
        .join(",");
      if (!vertices.has(key)) vertices.set(key, []);
      vertices.get(key).push(t.normals[i]);
    }
  }
  assert.ok(count >= 120);
  assert.equal(corners.size, 4);
  for (const normals of vertices.values())
    for (const a of normals)
      for (const b of normals)
        assert.ok(
          a.dot(b) >= cosine,
          "UV splits do not introduce an apron normal discontinuity",
        );
});

test("shading repair leaves actual wood triangles and mitered UV cuts unchanged", () => {
  // Canonical world-space triangle+UV1 signature captured before the repair.
  // Ignore corner ordering and normal-induced vertex splits, not physical data.
  assert.equal(
    woodGeometrySignature(triangles),
    "68ef3ddfc1b53904a8050ad4c9698f4bbded210a82b0e5df2f8e81c1cd0eb423",
  );
  for (const t of triangles) {
    assert.ok(t.attributes.includes("TEXCOORD_1"));
    assert.ok(
      !t.attributes.includes("TANGENT"),
      "UV1 normal mapping uses its own derivative frame",
    );
  }
});
