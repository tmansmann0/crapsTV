import test from "node:test";
import assert from "node:assert/strict";
import {
  createLabelTransition,
  sampleLabelTransition,
  rectsOverlap,
} from "../src/label-motion.js";
import { layoutSeatLabels } from "../src/seat-label-layout.js";
const from = { id: "a", x: 0, y: 10, width: 50, height: 30 },
  to = { ...from, x: 200 };

test("Smooth moves use continuous eased positions and exact final placement", () => {
  const motion = createLabelTransition(from, to, 1000);
  assert.equal(motion.kind, "move");
  assert.equal(sampleLabelTransition(motion, 1000).rect.x, 0);
  assert.equal(sampleLabelTransition(motion, 1130).rect.x, 100);
  assert.equal(sampleLabelTransition(motion, 1260).rect.x, 200);
  assert.equal(sampleLabelTransition(motion, 1500).done, true);
  const positions = Array.from(
    { length: 27 },
    (_, i) => sampleLabelTransition(motion, 1000 + i * 10).rect.x,
  );
  assert.ok(positions.every((x, i) => !i || x >= positions[i - 1]));
});

test("blocked paths fade at safe endpoints instead of crossing chips or HUD", () => {
  const chip = { x: 90, y: 0, width: 50, height: 60 };
  const motion = createLabelTransition(from, to, 1000, { obstacles: [chip] });
  assert.equal(motion.kind, "fade");
  for (let now = 1000; now <= 1260; now += 5) {
    const frame = sampleLabelTransition(motion, now);
    if (frame.opacity > 0) assert.equal(rectsOverlap(frame.rect, chip), false);
  }
  assert.equal(sampleLabelTransition(motion, 1130).opacity, 0);
  const coveredStart = createLabelTransition(from, to, 1000, {
    obstacles: [from],
  });
  assert.equal(coveredStart.kind, "appear");
  assert.equal(sampleLabelTransition(coveredStart, 1000).opacity, 0);
  assert.deepEqual(sampleLabelTransition(coveredStart, 1200).rect, to);
});

test("Stable is immediate, and all motion samples are deterministic without mutating inputs", () => {
  const original = structuredClone({ from, to });
  const still = createLabelTransition(from, to, 0, { mode: "stable" });
  assert.deepEqual(sampleLabelTransition(still, 0), {
    rect: to,
    opacity: 1,
    done: true,
  });
  const motion = createLabelTransition(from, to, 0);
  const expected = sampleLabelTransition(motion, 111);
  for (let now = 0; now < 111; now += 1000 / 144)
    sampleLabelTransition(motion, now);
  assert.deepEqual(sampleLabelTransition(motion, 111), expected);
  assert.deepEqual({ from, to }, original);
});

test("Smooth keeps an eight-pixel deadband but can choose a closer slot than Stable", () => {
  const first = layoutSeatLabels([{ id: "a", x: 800, y: 700 }], {
    width: 1920,
    height: 1080,
  });
  const offset = [{ ...first[0], x: first[0].x - 200 }];
  const jitter = layoutSeatLabels([{ id: "a", x: 803, y: 698 }], {
    width: 1920,
    height: 1080,
    previous: offset,
    motion: "smooth",
  });
  assert.equal(jitter[0].x, offset[0].x);
  const options = { width: 1920, height: 1080, previous: offset };
  const smooth = layoutSeatLabels([{ id: "a", x: 820, y: 700 }], {
    ...options,
    motion: "smooth",
  });
  const stable = layoutSeatLabels([{ id: "a", x: 820, y: 700 }], {
    ...options,
    motion: "stable",
  });
  assert.ok(smooth[0].x > stable[0].x + 100);
});
