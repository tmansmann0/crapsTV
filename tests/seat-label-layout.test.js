import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as THREE from "three";
import {
  layoutSeatLabels,
  selectWagerLabels,
  financialLabelMode,
} from "../src/seat-label-layout.js";

test("financial cards hide for throws, results and payouts but freeze during ordinary placements", () => {
  const state = { status: "playing", rolling: false };
  assert.equal(financialLabelMode(state, [], 0, true, false), "live");
  assert.equal(
    financialLabelMode({ ...state, rolling: true }, [], 0, true, true),
    "hidden",
  );
  assert.equal(financialLabelMode(state, [], 0, false, true), "hidden");
  assert.equal(
    financialLabelMode(state, [{ kind: "win" }], 0, true, true),
    "hidden",
  );
  assert.equal(
    financialLabelMode(state, [{ kind: "return" }], 0, true, true),
    "hidden",
  );
  assert.equal(financialLabelMode(state, [], 1, true, true), "hidden");
  assert.equal(
    financialLabelMode(state, [{ kind: "wager" }], 0, true, true),
    "frozen",
  );
  assert.equal(
    financialLabelMode(state, [{ kind: "wager" }], 0, true, false),
    "hidden",
  );
});

test("existing card placements ignore pixel jitter but yield to a chip exclusion", () => {
  const anchors = [
    { id: "a", x: 800, y: 700 },
    { id: "b", x: 810, y: 705 },
  ];
  const first = layoutSeatLabels(anchors, { width: 1920, height: 1080 });
  const jittered = layoutSeatLabels(
    anchors.map((a) => ({ ...a, x: a.x + 3, y: a.y - 2 })),
    { width: 1920, height: 1080, previous: first },
  );
  assert.deepEqual(
    jittered.map(({ x, y }) => [x, y]),
    first.map(({ x, y }) => [x, y]),
  );
  const blockingChip = { ...first[0] };
  const moved = layoutSeatLabels(anchors, {
    width: 1920,
    height: 1080,
    previous: first,
    exclusions: [blockingChip],
  });
  assert.ok(moved.every((box) => !overlaps(box, blockingChip)));
});
import { createTVLayout } from "../src/tv-layout.js";
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

test("all twelve anchored labels fit the safe TV image without colliding with HUD or each other", () => {
  for (const [width, height] of [
    [1920, 1080],
    [3840, 2160],
  ])
    for (const position of [
      [0.01, 17, 8],
      [0, 6, 16],
      [11, 4.5, 19],
      [-8.6, 6.8, -6.2],
    ]) {
      const camera = new THREE.PerspectiveCamera(43, width / height, 0.1, 160);
      camera.position.fromArray(position);
      camera.lookAt(0, 0.4, 0.5);
      camera.updateMatrixWorld(true);
      const panels = createTVLayout(width, height).panels;
      const exclusions = ["brand", "settingsButton", "join", "status"].map(
        (name) => panels[name],
      );
      const anchors = seats.map((seat, id) => {
        const p = new THREE.Vector3(...seat.labelPosition).project(camera);
        return { id, x: ((p.x + 1) * width) / 2, y: ((1 - p.y) * height) / 2 };
      });
      const labels = layoutSeatLabels(anchors, {
        width,
        height,
        exclusions,
        labelScale: 1,
      });
      assert.equal(labels.length, 12, `${width}x${height}, camera ${position}`);
      for (const [index, label] of labels.entries()) {
        assert.equal(label.width, (220 * height) / 1080);
        assert.equal(label.height, (90 * height) / 1080);
        assert.ok(
          label.x >= (80 * height) / 1080 && label.y >= (60 * height) / 1080,
        );
        assert.ok(
          label.x + label.width <= width - (80 * height) / 1080 &&
            label.y + label.height <= height - (60 * height) / 1080,
        );
        assert.ok(exclusions.every((rect) => !overlaps(label, rect)));
        assert.ok(
          labels.slice(index + 1).every((other) => !overlaps(label, other)),
        );
      }
    }
});

test("twelve active bankroll cards and bounded wager labels fit without reducing their type size", () => {
  const width = 1920,
    height = 1080;
  const camera = new THREE.PerspectiveCamera(43, width / height, 0.1, 160);
  camera.position.set(0.01, 17, 8);
  camera.lookAt(0, 0.4, 0.5);
  camera.updateMatrixWorld(true);
  const panels = createTVLayout(width, height).panels;
  const exclusions = ["brand", "settingsButton", "join", "status"].map(
    (name) => panels[name],
  );
  const anchors = seats.map((seat, id) => {
    const p = new THREE.Vector3(...seat.labelPosition).project(camera);
    return {
      id,
      x: ((p.x + 1) * width) / 2,
      y: ((1 - p.y) * height) / 2,
      width: 220,
      height: 126,
    };
  });
  anchors.push(
    ...Array.from({ length: 4 }, (_, i) => ({
      id: `wager:${i}`,
      x: 800 + i * 30,
      y: 700,
      width: 116,
      height: 58,
    })),
  );
  const labels = layoutSeatLabels(anchors, {
    width,
    height,
    exclusions,
    labelScale: 1,
  });
  assert.equal(labels.length, 16);
  for (const [i, label] of labels.entries()) {
    assert.ok(exclusions.every((rect) => !overlaps(label, rect)));
    assert.ok(labels.slice(i + 1).every((rect) => !overlaps(label, rect)));
    assert.equal(label.height, i < 12 ? 126 : 58);
  }
});

test("label placement is deterministic and leaves source anchors/HUD untouched", () => {
  const anchors = [
    { id: 0, x: 900, y: 700 },
    { id: 1, x: 930, y: 700 },
    { id: 2, x: 920, y: 720 },
  ];
  const exclusions = [{ x: 700, y: 780, width: 400, height: 150 }];
  const before = JSON.stringify({ anchors, exclusions });
  const first = layoutSeatLabels(anchors, {
    width: 1920,
    height: 1080,
    exclusions,
  });
  assert.deepEqual(
    first,
    layoutSeatLabels(anchors, { width: 1920, height: 1080, exclusions }),
  );
  assert.equal(JSON.stringify({ anchors, exclusions }), before);
});

test("wide wager labels are bounded and prioritize the shooter, while closeups expose local amounts", () => {
  const candidates = Array.from({ length: 24 }, (_, i) => ({
    id: i,
    playerId: i < 8 ? "shooter" : "other",
    amount: 100 * (i + 1),
    pixels: 20,
  }));
  const original = JSON.stringify(candidates);
  const wide = selectWagerLabels(candidates, "shooter");
  assert.equal(wide.length, 4);
  assert.ok(wide.every((candidate) => candidate.playerId === "shooter"));
  assert.deepEqual(
    wide.map((candidate) => candidate.amount),
    [800, 700, 600, 500],
  );
  const close = selectWagerLabels(
    candidates.map((candidate) => ({ ...candidate, pixels: 80 })),
    "shooter",
  );
  assert.equal(close.length, 12);
  assert.ok(
    close.slice(0, 8).every((candidate) => candidate.playerId === "shooter"),
  );
  assert.equal(JSON.stringify(candidates), original);
});
