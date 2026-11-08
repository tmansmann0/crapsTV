// Standalone, isolated real-rules browser check; never joins a user's live room.
// Run: node tests/phone-odds.browser.mjs
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { chromium, expect } from "@playwright/test";

const root = fileURLToPath(new URL("../", import.meta.url));
const server = await createServer({
  configFile: false,
  root,
  logLevel: "error",
  esbuild: { jsx: "automatic" },
  server: { host: "127.0.0.1", port: 0 },
  optimizeDeps: {
    include: ["react", "react-dom/client", "react/jsx-runtime", "lucide-react"],
  },
});
await server.listen();
const port = server.httpServer.address().port;
let browser;
const checks = [];
try {
  browser = await chromium.launch({
    headless: true,
    args: [
      process.platform === "darwin" && !process.env.CI
        ? "--use-angle=metal"
        : "--use-angle=swiftshader",
      "--enable-webgl",
      "--ignore-gpu-blocklist",
    ],
  });
  await mkdir(new URL("../artifacts/", import.meta.url), { recursive: true });
  for (const [width, height] of [
    [390, 844],
    [375, 640],
  ]) {
    const page = await browser.newPage({ viewport: { width, height } });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/__odds-test", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: '<html><head><style>html,body,#root{margin:0;width:100%;height:100%;overflow:hidden}</style></head><body><div id="root"></div><script type="module" src="/tests/fixtures/phone-odds.jsx"></script></body></html>',
      }),
    );
    await page.goto(`http://127.0.0.1:${port}/__odds-test`);
    const cue = page.locator('[data-odds-cue="pass"]');
    await expect(cue).toContainText("Bet Pass Line first");
    let passBox = await page.locator('[data-bet-id="pass"]').boundingBox();
    let cueBox = await cue.boundingBox();
    assert(
      cueBox.y >= passBox.y + passBox.height - 2,
      "odds cue follows Pass Line",
    );
    await page.evaluate(() => window.oddsFixture.reset({ hasLine: true }));
    await expect(cue).toContainText("Open once the point is set");
    await page.evaluate(() => window.oddsFixture.reset({ point: 4 }));
    await expect(cue).toContainText("Need a Pass Line bet from the come-out");

    await page.evaluate(() =>
      window.oddsFixture.reset({ point: 4, hasLine: true }),
    );
    const parent = await page.evaluate(
      () =>
        window.oddsFixture.state.players[0].bets.find((b) => b.type === "pass")
          .id,
    );
    const odds = page.locator(`[data-bet-id="odds:${parent}"]`);
    await expect(odds).toBeEnabled();
    await expect(odds).toContainText("Pass Odds · 4");
    await expect(odds).toContainText("$24");
    await expect(odds).toContainText("Min $6 · $3 steps");
    await expect(odds).toHaveAccessibleName(/Pays 6:3.*Total odds limit \$25/);
    assert(
      (await odds.boundingBox()).height >= 43.5,
      "active odds row meets a 44px tap target",
    );
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      "active odds row has no horizontal overflow",
    );
    await odds.click();
    await page
      .getByRole("button", {
        name: "Bet $6 on Take odds · pass 4",
        exact: true,
      })
      .click();
    await expect(odds).toHaveAccessibleName(/your stake \$6/);
    await expect(page.locator(".pg-notice")).toContainText("Placed $6");
    const placed = await page.evaluate(() =>
      window.oddsFixture.messages.filter((m) => m.type === "bet").at(-1),
    );
    assert.equal(placed.betId, `odds:${parent}`);
    assert.equal(placed.amount, 600);
    await page.screenshot({
      path: fileURLToPath(
        new URL(
          `../artifacts/phone-odds-${width}x${height}.png`,
          import.meta.url,
        ),
      ),
    });
    await page.getByRole("button", { name: /^More bets/ }).click();
    await expect(page.locator(`[data-bet-id="odds:${parent}"]`)).toHaveCount(0);
    await page.getByRole("button", { name: "Table", exact: true }).click();
    await expect(odds).toHaveCount(1);

    // Drag a real $6 bundle to the actual parent-linked row.
    await page.evaluate(() =>
      window.oddsFixture.reset({ point: 4, hasLine: true }),
    );
    await page
      .getByRole("button", { name: "Add $1 chip", exact: true })
      .click();
    const parent2 = await page.evaluate(
      () =>
        window.oddsFixture.state.players[0].bets.find((b) => b.type === "pass")
          .id,
    );
    const target = page.locator(`[data-bet-id="odds:${parent2}"]`);
    await expect(target).toBeVisible();
    const sourceBox = await page
      .getByRole("button", { name: /^Bundle of \$6\./ })
      .boundingBox();
    const targetBox = await target.boundingBox();
    await page.mouse.move(
      sourceBox.x + sourceBox.width / 2,
      sourceBox.y + sourceBox.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      targetBox.x + targetBox.width / 2,
      targetBox.y + targetBox.height / 2,
      { steps: 8 },
    );
    await page.mouse.up();
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            window.oddsFixture.messages.filter((m) => m.type === "bet").at(-1)
              ?.amount,
        ),
      )
      .toBe(600);
    assert.equal(
      await page.evaluate(
        () =>
          window.oddsFixture.messages.filter((m) => m.type === "bet").at(-1)
            ?.betId,
      ),
      `odds:${parent2}`,
    );

    await page.evaluate(() =>
      window.oddsFixture.reset({ point: 4, hasLine: true }),
    );
    await page.evaluate(() => window.oddsFixture.placeOdds(2400));
    await expect(page.locator(".pg-tile-odds")).toBeDisabled();
    await expect(page.locator(".pg-tile-odds")).toContainText("At odds limit");
    await page.evaluate(() =>
      window.oddsFixture.reset({ point: 4, hasLine: true, bank: 500 }),
    );
    await expect(page.locator(".pg-tile-odds")).toBeDisabled();
    await expect(page.locator(".pg-tile-odds")).toContainText("Bank too low");
    await page.evaluate(() =>
      window.oddsFixture.reset({ point: 4, hasLine: true }),
    );
    await expect(page.locator(".pg-tile-odds")).toBeEnabled();
    await page.evaluate(() => window.oddsFixture.finishPoint());
    await expect(cue).toContainText("Bet Pass Line first");
    await expect(page.locator(".pg-tile-odds")).toHaveCount(0);

    await page.evaluate(() =>
      window.oddsFixture.reset({ point: 4, hasLine: true, line: "dont" }),
    );
    await expect(page.locator(".pg-board-dont .pg-tile-odds")).toBeEnabled();
    await expect(page.locator(".pg-board-dont .pg-tile-odds")).toContainText(
      "Don’t Odds · 4",
    );
    const bounds = await page.evaluate(() => ({
      width: innerWidth,
      document: document.documentElement.scrollWidth,
      body: document.body.scrollWidth,
    }));
    assert(
      bounds.document <= bounds.width && bounds.body <= bounds.width,
      `no horizontal overflow at ${width}×${height}`,
    );
    assert.deepEqual(errors, []);
    checks.push({
      width,
      height,
      passed: [
        "missing line",
        "missing point",
        "point without line",
        "authoritative row",
        "visible minimum and increments",
        "accessible payout and cap",
        "44px odds tap target",
        "exact quick amount",
        "no duplicate in More",
        "drag target parent",
        "odds cap",
        "low bank",
        "point resolves",
        "dont odds",
        "no horizontal overflow",
      ],
    });
    await page.close();
  }
  await writeFile(
    new URL("../artifacts/phone-odds-qa.json", import.meta.url),
    JSON.stringify(checks, null, 2),
  );
  console.log(JSON.stringify(checks));
} finally {
  await browser?.close();
  await server.close();
}
