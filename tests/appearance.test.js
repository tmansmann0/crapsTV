import test from "node:test";
import assert from "node:assert/strict";
import * as game from "../src/game.js";
import { createDicePhysics, BOUNDS } from "../src/dice-physics.js";
test("only the current shooter may change validated dice, and never during a roll", () => {
  const s = game.createState("TESTAA"),
    a = game.join(s, "A"),
    b = game.join(s, "B");
  game.start(s, a.id);
  game.setDiceAppearance(s, a.id, { color: "blue", finish: "translucent" });
  assert.deepEqual(a.dice, { color: "blue", finish: "translucent" });
  assert.throws(() =>
    game.setDiceAppearance(s, b.id, { color: "red", finish: "solid" }),
  );
  assert.throws(() =>
    game.setDiceAppearance(s, a.id, { color: "pink", finish: "solid" }),
  );
  assert.throws(() =>
    game.setDiceAppearance(s, a.id, { color: "red", finish: "glass" }),
  );
  game.beginRoll(s, a.id);
  assert.throws(() =>
    game.setDiceAppearance(s, a.id, { color: "green", finish: "solid" }),
  );
  game.finishRoll(s, [2, 2]);
  game.beginRoll(s, a.id);
  game.finishRoll(s, [3, 4]);
  game.setDiceAppearance(s, b.id, { color: "green", finish: "solid" });
  assert.equal(b.dice.color, "green");
});
test("TV settings are admin-only and validate camera/sound values", () => {
  const s = game.createState(),
    a = game.join(s, "A"),
    b = game.join(s, "B");
  assert.throws(() => game.setDisplaySettings(s, b.id, { sound: true }));
  assert.throws(() => game.setDisplaySettings(s, a.id, { sound: "yes" }));
  assert.throws(() => game.setDisplaySettings(s, a.id, { camera: "invalid" }));
  game.setDisplaySettings(s, a.id, { sound: true, camera: "room" });
  assert.equal(s.display.sound, true);
  assert.equal(s.display.camera, "room");
  assert.equal(s.display.revision, 1);
});
test("seat positions are stable and released seats can be reused", () => {
  const s = game.createState(),
    a = game.join(s, "A"),
    b = game.join(s, "B");
  assert.notEqual(a.seat, b.seat);
  game.leave(s, a.id);
  const c = game.join(s, "C");
  assert.equal(c.seat, a.seat);
  assert.equal(b.seat, 1);
});
test("visual dice bounce against rubber rails and stay above the felt", () => {
  const p = createDicePhysics();
  p.throwDice(7);
  let maximumZ = -Infinity;
  for (let i = 0; i < 420; i++) {
    p.step(1 / 120);
    for (const b of p.bodies) {
      maximumZ = Math.max(maximumZ, Math.abs(b.position.z));
      assert(b.position.y > -0.05);
      assert(Math.abs(b.position.x) < BOUNDS.x + 0.25);
    }
  }
  assert(p.wallHits > 0);
  assert(maximumZ < BOUNDS.z + 0.2);
});

test("visual wall bounces remain correct at slow render cadence", () => {
  const p = createDicePhysics();
  p.throwDice(2);
  for (let i = 0; i < 8; i++) p.step(0.25);
  assert(p.wallHits > 0);
  for (const b of p.bodies) assert(Math.abs(b.position.z) < BOUNDS.z + 0.2);
});
