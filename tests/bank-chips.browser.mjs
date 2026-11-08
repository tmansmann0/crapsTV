import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "vite";
import { chromium } from "@playwright/test";

const server = await createServer({
  logLevel: "error",
  server: { host: "127.0.0.1", port: 0, hmr: false },
});
let browser;
const width = process.env.CI ? 960 : 1920,
  height = process.env.CI ? 540 : 1080;
try {
  await server.listen();
  browser = await chromium.launch({
    headless: true,
    args: [
      `--use-angle=${process.platform === "darwin" && !process.env.CI ? "metal" : "swiftshader"}`,
      "--enable-webgl",
      "--ignore-gpu-blocklist",
    ],
  });
  const page = await browser.newPage({ viewport: { width, height } });
  await page.addInitScript((software) => {
    window.bankFixtureSoftware = software;
  }, !!process.env.CI);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/__bank-preview", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<html><body style="margin:0"><div id="root"></div><script type="module" src="/tests/fixtures/bank-preview.jsx"></script></body></html>',
    }),
  );
  await page.goto(
    `http://127.0.0.1:${server.httpServer.address().port}/__bank-preview`,
  );
  await page.waitForFunction(
    () =>
      document.querySelector(".table-canvas")?.dataset.sceneReady === "true",
    null,
    { timeout: 90000 },
  );
  await page.keyboard.press("Escape");
  await page.waitForFunction(
    () =>
      document.querySelector(".table-canvas")?.dataset.graphicsIntro ===
      "false",
    null,
    { timeout: 30000 },
  );
  const settle = () =>
    page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() =>
            requestAnimationFrame(() => requestAnimationFrame(resolve)),
          ),
        ),
    );
  const read = () => page.evaluate(() => window.bankQA.metadata());
  const seek = async (now) => {
    await page.evaluate((now) => window.bankQA.seek(now), now);
    await settle();
    return read();
  };
  await settle();
  const initial = await read();
  assert.equal(initial.bank, 100000);
  assert(initial.chips.length >= 35 && initial.chips.length <= 55);
  assert.equal(Math.max(...initial.chips.map((c) => c.level)), 9);
  assert(new Set(initial.chips.map((c) => c.denomination)).size >= 4);
  const unchanged = (before, after) => {
    const old = new Map(before.chips.map((c) => [c.id, c]));
    for (const chip of after.chips)
      if (old.has(chip.id)) {
        const previous = old.get(chip.id);
        assert.equal(chip.denomination, previous.denomination);
        assert.equal(chip.wear, previous.wear);
        assert.deepEqual(chip.position, previous.position);
      }
  };
  let at = await page.evaluate(() => window.bankQA.bet(20000));
  const eight = await seek(at + 2000);
  assert.equal(eight.bank, 80000);
  unchanged(initial, eight);
  at = await page.evaluate(() => window.bankQA.bet(500));
  const seven = await seek(at + 2000);
  assert.equal(seven.bank, 79500);
  unchanged(eight, seven);
  assert(
    seven.wagers.every((chip) =>
      initial.chips.some(
        (old) =>
          old.id === chip.id &&
          old.denomination === chip.denomination &&
          old.wear === chip.wear,
      ),
    ),
    "The actual spent bank chips are on the felt",
  );
  const plan = await page.evaluate(() => window.bankQA.win());
  const flow = plan.transfers.find((f) => f.to.kind === "bank");
  assert(flow);
  const end = Math.min(flow.startAt + flow.duration, flow.cutAt ?? Infinity);
  await seek(flow.startAt + 200);
  const flying = await read();
  assert(
    flying.flights.some((f) => f.flow.id === flow.id && f.chips.length > 1),
  );
  const contact = await seek(end + 1);
  const added = contact.chips.filter(
    (c) => !seven.chips.some((old) => old.id === c.id),
  );
  assert(
    added.length > 1,
    "Payout adds real chips rather than recolouring the rack",
  );
  const after = await seek(end + 1000);
  assert.equal(after.bank, 120500);
  assert.equal(
    after.chips.reduce((sum, c) => sum + c.denomination, 0),
    after.bank,
  );
  assert(Math.max(...after.chips.map((c) => c.level)) < 10);
  const flightChips = flying.flights.find((f) => f.flow.id === flow.id).chips;
  assert(
    seven.wagers.every((chip) =>
      flightChips.some(
        (flying) =>
          flying.id === chip.id &&
          flying.denomination === chip.denomination &&
          flying.wear === chip.wear,
      ),
    ),
    "A winning stake leaves the felt without being reissued in other colours",
  );
  assert(
    flightChips.every((c) =>
      after.chips.some(
        (bank) => bank.id === c.id && bank.denomination === c.denomination,
      ),
    ),
    "The actual winning chips land in the bank",
  );
  const matrixMotion = added.some((chip) => {
    const rest = after.chips.find((c) => c.id === chip.id);
    return Math.abs(chip.matrix[13] - rest.matrix[13]) > 1e-6;
  });
  assert(
    matrixMotion,
    "Contact includes a small physical rebound before settling",
  );
  assert.deepEqual(errors, []);
  await mkdir("artifacts/bank-chips", { recursive: true });
  await page.screenshot({ path: "artifacts/bank-chips/settled-1080p.png" });
  // Many small awards fill the tray and exercise real colour-ups/restacks.
  // Each update still passes through the ordinary production flow planner.
  for (let index = 0; index < 100; index++) {
    const at = await page.evaluate(() => window.bankQA.credit(500));
    await seek(at + 1151);
  }
  const full = await seek((await read()).now + 2000);
  assert.equal(full.bank, 170500);
  assert(full.chips.length <= 100);
  assert(Math.max(...full.chips.map((c) => c.level)) < 10);
  assert.equal(
    full.chips.reduce((sum, c) => sum + c.denomination, 0),
    full.bank,
  );
  assert.deepEqual(errors, []);
  const report = {
    initial: initial.chips.length,
    viewport: { width, height },
    after: after.chips.length,
    maxStack: Math.max(...after.chips.map((c) => c.level)) + 1,
    landingChips: added.length,
    bank: after.bank,
    after100SmallAwards: { chips: full.chips.length, bank: full.bank },
    errors,
  };
  await writeFile(
    "artifacts/bank-chips/report.json",
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report));
} finally {
  await browser?.close();
  await server.close();
}
