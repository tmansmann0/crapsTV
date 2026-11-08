import test from "node:test";
import assert from "node:assert/strict";
import { validBetChoices } from "../src/bet-options.js";
import * as game from "../src/game.js";
const setup = () => {
  const s = game.createState("QUICK");
  const p = game.join(s, "A");
  game.configure(s, p.id, { rollCooldownSeconds: 0 }); // Immediate rolls for this isolated fixture.
  game.start(s, p.id);
  return { s, p };
};
test("place six offers explicit legal neighbors rather than silently rounding", () => {
  const { s, p } = setup();
  const row = game.catalogue(s, p).find((b) => b.id === "place-6");
  assert.deepEqual(validBetChoices(row, 1000, p), {
    minimum: 600,
    step: 600,
    maximum: 99600,
    requested: 1000,
    valid: false,
    lower: 600,
    upper: 1200,
    quick: [600, 1200, 3000],
    reason: "This bet needs a different chip increment.",
  });
  assert.equal(validBetChoices(row, 500, p).lower, null);
  assert.equal(validBetChoices(row, 500, p).upper, 600);
});
test("quick amounts fit actual bank and ruleset increments", () => {
  const { s, p } = setup();
  s.config.mode = "crapless";
  p.bank = 1300;
  const row = game.catalogue(s, p).find((b) => b.id === "place-3");
  const choices = validBetChoices(row, 1500, p);
  assert.equal(choices.lower, 1200);
  assert.equal(choices.upper, null);
  for (const n of choices.quick)
    assert(n >= row.minimum && n % row.quantum === 0 && n <= p.bank);
});
test("remaining odds limit includes odds already on the board", () => {
  const { s, p } = setup();
  game.place(s, p.id, "pass", 500);
  game.beginRoll(s, p.id);
  game.finishRoll(s, [3, 3]);
  let row = game.catalogue(s, p).find((b) => b.parent);
  game.place(s, p.id, row.id, 2000);
  row = game.catalogue(s, p).find((b) => b.parent);
  const choices = validBetChoices(row, 900, p);
  assert.equal(choices.maximum, 500);
  assert.equal(choices.lower, 500);
  assert.equal(choices.upper, null);
  assert(choices.quick.every((n) => n <= 500));
});
test("unavailable bets and banks below minimum offer no misleading quick bet", () => {
  const { s, p } = setup();
  let row = game.catalogue(s, p).find((b) => b.id === "come");
  assert.deepEqual(validBetChoices(row, 500, p).quick, []);
  row = game.catalogue(s, p).find((b) => b.id === "place-6");
  p.bank = 500;
  assert.equal(validBetChoices(row, 100, p).upper, null);
  assert.deepEqual(validBetChoices(row, 100, p).quick, []);
});
