import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import {
  projectChipFootprints,
  puckFootprintBounds,
} from "../src/chip-footprints.js";
import { layoutSeatLabels } from "../src/seat-label-layout.js";
import { sampleTableCamera, fitBettingCamera } from "../src/throw-camera.js";
import { readFileSync } from "node:fs";
const seats = JSON.parse(
  readFileSync(
    new URL("../public/assets/table-player-rails-layout.json", import.meta.url),
  ),
).seats;
const overlaps = (a, b) =>
  a.x < b.x + b.width &&
  a.x + a.width > b.x &&
  a.y < b.y + b.height &&
  a.y + a.height > b.y;

test("moving and tipped puck bounds reserve its full visible cylinder", () => {
  for (const angle of [0, Math.PI / 4, Math.PI / 2]) {
    const pose = {
      position: [1, 0.25, -2],
      quaternion: new THREE.Quaternion()
        .setFromEuler(new THREE.Euler(angle, 0, 0))
        .toArray(),
    };
    const bounds = puckFootprintBounds(pose);
    for (let step = 0; step < 32; step++)
      for (const y of [-0.0425, 0.0425]) {
        const theta = (step / 32) * Math.PI * 2;
        const p = new THREE.Vector3(
          0.2 * Math.cos(theta),
          y,
          0.2 * Math.sin(theta),
        )
          .applyQuaternion(new THREE.Quaternion(...pose.quaternion))
          .add(new THREE.Vector3(...pose.position));
        p.toArray().forEach((value, i) =>
          assert.ok(value >= bounds.min[i] && value <= bounds.max[i]),
        );
      }
    const camera = new THREE.PerspectiveCamera(43, 16 / 9, 0.1, 160);
    camera.position.set(0, 12, 2);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld(true);
    const [rect] = projectChipFootprints([], camera, 1920, 1080, {
      extraBounds: [bounds],
    }).filter((r) => r.id === "puck");
    assert.ok(rect && rect.width > 0 && rect.height > 0);
    const label = layoutSeatLabels(
      [
        {
          id: "amount",
          x: rect.x + rect.width / 2,
          y: rect.y + rect.height / 2,
          width: 116,
          height: 58,
        },
      ],
      { width: 1920, height: 1080, exclusions: [rect] },
    )[0];
    assert.ok(label && !overlaps(label, rect));
  }
});

test("default player cards are one third smaller, with explicit large-size compatibility", () => {
  const anchor = [{ id: "one", x: 960, y: 540 }];
  const [normal] = layoutSeatLabels(anchor, { width: 1920, height: 1080 });
  const [large] = layoutSeatLabels(anchor, {
    width: 1920,
    height: 1080,
    labelScale: 1,
  });
  assert.ok(Math.abs(normal.width / large.width - 2 / 3) < 1e-6);
  assert.ok(Math.abs(normal.height / large.height - 2 / 3) < 1e-6);
});

test("projected bank and wager chip regions exclude labels in overhead and corner views", () => {
  const stacks = seats.flatMap((seat, i) =>
    seat.stackSlots.slice(0, 4).map((slot, j) => ({
      id: `bank:p${i}:${j}`,
      chips: Array.from({ length: 8 }, (_, n) => ({
        diameter: 0.23,
        thicknessScale: 1.15,
        position: [
          slot.position[0],
          slot.position[1] + 0.03 + n * 0.037,
          slot.position[2],
        ],
      })),
    })),
  );
  stacks.push({
    id: "wager:one",
    chips: [{ diameter: 0.31, thicknessScale: 1.3, position: [0, 0.04, 2] }],
  });
  for (const [width, height] of [
    [1920, 1080],
    [3840, 2160],
  ])
    for (const view of [
      { kind: "overview", ...fitBettingCamera({ aspect: width / height }) },
      {
        kind: "betting",
        ...sampleTableCamera({
          state: { status: "playing" },
          now: 0,
          aspect: width / height,
        }),
      },
      { kind: "low", position: [5, 0.38, 2.3], target: [0, 0.15, 0], fov: 54 },
    ]) {
      const camera = new THREE.PerspectiveCamera(
        view.fov,
        width / height,
        0.035,
        160,
      );
      camera.position.fromArray(view.position);
      camera.lookAt(new THREE.Vector3(...view.target));
      camera.updateMatrixWorld(true);
      const regions = projectChipFootprints(stacks, camera, width, height, {
        motionPadding: 0.44,
      });
      assert.ok(regions.length > 0);
      if (view.kind === "overview") assert.ok(regions.length >= 12);
      const anchors = seats.flatMap((seat, id) => {
        const p = new THREE.Vector3(...seat.labelPosition).project(camera);
        if (p.z < -1 || p.z > 1 || Math.abs(p.x) > 1.2 || Math.abs(p.y) > 1.2)
          return [];
        return [
          {
            id,
            x: ((p.x + 1) * width) / 2,
            y: ((1 - p.y) * height) / 2,
            height: 126,
          },
        ];
      });
      const labels = layoutSeatLabels(anchors, {
        width,
        height,
        exclusions: regions,
      });
      if (view.kind === "overview") assert.equal(labels.length, 12);
      for (const label of labels)
        assert.ok(regions.every((region) => !overlaps(label, region)));
      for (const stack of stacks)
        for (const chip of stack.chips) {
          const p = new THREE.Vector3(...chip.position).project(camera);
          const x = ((p.x + 1) * width) / 2,
            y = ((1 - p.y) * height) / 2;
          if (
            p.z >= -1 &&
            p.z <= 1 &&
            x >= 0 &&
            x <= width &&
            y >= 0 &&
            y <= height
          )
            assert.ok(
              regions.some(
                (region) =>
                  x >= region.x &&
                  x <= region.x + region.width &&
                  y >= region.y &&
                  y <= region.y + region.height,
              ),
            );
        }
    }
});
