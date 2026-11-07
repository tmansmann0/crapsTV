import test from "node:test";
import assert from "node:assert/strict";
import { betRoute } from "../src/chip-flow.js";
import {
  chipPileSpecs,
  wagerPileLayout,
  wagerStackLayout,
  MAX_WAGER_STACKS,
  wagerPosition,
  wagerRegion,
} from "../src/wager-layout.js";
import { catalogue, createState, POINTS, ALL_POINTS } from "../src/game.js";
import { boardWorldToPixel, boardPixelToWorld } from "../src/board-layout.js";

test("physical pile cylinder encloses every rendered chip, including visual offsets", () => {
  for (const mode of ["craps", "crapless"])
    for (const type of [
      "pass",
      "dont",
      "come",
      "field",
      "place-6",
      "hard-8",
      "prop-7",
    ])
      for (const amount of [500, 1900, 252500, 100000000]) {
        const bet = { id: `${type}:${amount}`, type, amount };
        const state = {
          config: { mode },
          players: [{ id: "p", seat: 4, bets: [bet] }],
        };
        const route = betRoute("p", bet, [bet]);
        const cylinder = wagerPileLayout(route, state);
        const chips = chipPileSpecs(amount, {
          diameter: cylinder.diameter,
          seed: bet.id,
        });
        assert.equal(chips.length, cylinder.chipCount);
        assert.ok(cylinder.chipCount <= 8);
        for (const chip of chips) {
          const half = (0.13 * chip.diameter * chip.thicknessScale) / 2;
          const y = chip.position[1] + cylinder.basePosition[1];
          assert.ok(
            Math.hypot(chip.position[0], chip.position[2]) +
              chip.diameter / 2 <=
              cylinder.radius + 1e-9,
          );
          assert.ok(
            y - half >= cylinder.position[1] - cylinder.height / 2 - 1e-9,
          );
          assert.ok(
            y + half <= cylinder.position[1] + cylinder.height / 2 + 1e-9,
          );
        }
      }
});

test("shared layout places odds with their parent and ignores departed players", () => {
  const bets = [
    { id: "line", type: "pass", point: 6, amount: 500 },
    { id: "odds", type: "odds", parent: "line", point: 6, amount: 1000 },
  ];
  const state = {
    config: { mode: "craps" },
    players: [
      { id: "p", seat: 0, bets },
      { id: "left", left: true, seat: 1, bets },
    ],
  };
  const before = JSON.stringify(state),
    stacks = wagerStackLayout(state);
  assert.equal(stacks.length, 2);
  assert.equal(stacks[0].position[0], stacks[1].position[0]);
  assert.ok(stacks[1].position[2] > stacks[0].position[2]);
  assert.match(stacks[1].id, /:pass$/);
  assert.equal(JSON.stringify(state), before);
});

test("all twelve player lanes remain inside the physical bed and descriptor count is bounded", () => {
  const players = Array.from({ length: 12 }, (_, seat) => ({
    id: `p${seat}`,
    seat,
    bets: [{ id: `b${seat}`, type: "pass", amount: 500 }],
  }));
  const stacks = wagerStackLayout({ config: { mode: "craps" }, players });
  assert.equal(new Set(stacks.map((s) => s.position[0])).size, 12);
  for (const stack of stacks) {
    assert.ok(Math.abs(stack.position[0]) + stack.radius < 5.42);
    assert.ok(Math.abs(stack.position[2]) + stack.radius < 2.71);
  }
  const over = {
    config: { mode: "craps" },
    players: [
      {
        id: "p",
        seat: 0,
        bets: Array.from({ length: MAX_WAGER_STACKS + 1 }, (_, i) => ({
          id: String(i),
          type: "field",
          amount: 500,
        })),
      },
    ],
  };
  assert.throws(() => wagerStackLayout(over), /Too many/);
});

test("every wager's fixed twelve seat positions stay in its own printed region", () => {
  for (const mode of ["craps", "crapless"]) {
    const base = createState("REGION");
    base.config.mode = mode;
    const bets = catalogue(base).map((row) => ({
      id: row.id,
      type: row.id,
      amount: 2500,
    }));
    for (const point of mode === "crapless" ? ALL_POINTS : POINTS) {
      bets.push({ id: `come-${point}`, type: "come", point, amount: 2500 });
      bets.push({
        id: `come-odds-${point}`,
        type: "odds",
        point,
        parentType: "come",
        amount: 2500,
      });
      bets.push({
        id: `pass-odds-${point}`,
        type: "odds",
        point,
        parentType: "pass",
        amount: 2500,
      });
      if (mode === "craps")
        bets.push({ id: `dont-${point}`, type: "dont", point, amount: 2500 });
    }
    for (const bet of bets)
      for (let seat = 0; seat < 12; seat++) {
        const state = {
          config: { mode },
          players: [{ id: "p", seat, bets: [bet] }],
        };
        const route = { kind: "bet", playerId: "p", bet };
        const layout = wagerPileLayout(route, state),
          region = wagerRegion(bet, mode);
        assert(region, `${mode} ${bet.id} mapped`);
        const pixel = boardWorldToPixel(
          layout.basePosition[0],
          layout.basePosition[2],
        );
        const rects = (region.pixelRects || [region.pixelRect]).filter(
          ([x, y, w, h]) =>
            pixel[0] >= x - 1e-8 &&
            pixel[0] <= x + w + 1e-8 &&
            pixel[1] >= y - 1e-8 &&
            pixel[1] <= y + h + 1e-8,
        );
        assert(
          rects.length,
          `${mode} ${bet.id} seat${seat} center stays in its bet`,
        );
        const fitting = rects.find(
          ([x, y, w, h]) =>
            Math.min((w / 2048) * 10.84, (h / 1024) * 5.4) >= layout.radius * 2,
        );
        if (fitting) {
          const [x, y, w, h] = fitting,
            [left, top] = boardPixelToWorld(x, y),
            [right, bottom] = boardPixelToWorld(x + w, y + h);
          assert(
            layout.basePosition[0] - layout.radius >= left - 1e-8 &&
              layout.basePosition[0] + layout.radius <= right + 1e-8 &&
              layout.basePosition[2] - layout.radius >= top - 1e-8 &&
              layout.basePosition[2] + layout.radius <= bottom + 1e-8,
            `${mode} ${bet.id} seat${seat} full rendered/physical footprint fits`,
          );
        }
        assert.deepEqual(
          wagerPosition(route, {
            ...state,
            players: Array.from({ length: 12 }, (_, index) => ({
              id: index === seat ? "p" : `other${index}`,
              seat: index,
              bets: index === seat ? [bet] : [],
            })),
          }),
          layout.basePosition,
          "adding unrelated players cannot reflow a wager",
        );
      }
  }
});
