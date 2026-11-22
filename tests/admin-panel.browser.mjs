// UI-only authority fixture. The full bot browser proof separately uses RoomHub.
import { createServer } from "vite";
import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { openAdminSection } from "./helpers/admin-controls.mjs";
const server = await createServer({
  server: { host: "127.0.0.1", port: 0, hmr: false },
  logLevel: "error",
});
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true, args: ["--disable-gpu"] });
  const page = await browser.newPage({
      viewport: { width: 375, height: 812 },
      isMobile: true,
    }),
    errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/__admin-preview", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<html><head><meta name="viewport" content="width=device-width,initial-scale=1"/></head><body><div id="root"></div><script type="module" src="/tests/fixtures/admin-preview.jsx"></script></body></html>',
    }),
  );
  await page.goto(
    `http://127.0.0.1:${server.httpServer.address().port}/__admin-preview`,
  );
  await page.getByRole("heading", { name: "Table setup" }).waitFor();
  await expect(page.getByLabel("Teach mode")).not.toBeChecked();
  await expect(page.getByLabel("Bot roll delay (seconds)")).toHaveValue("5");
  await expect(page.locator(".ha-rules fieldset").first()).toContainText(
    "Table minimum ($)",
  );
  await mkdir("artifacts/admin-ux", { recursive: true });
  await page.screenshot({
    path: "artifacts/admin-ux/table-375.png",
    fullPage: true,
  });
  const drinkingMode = page.getByRole("button", {
    name: "Drinking Mode",
    exact: true,
  });
  await drinkingMode.click();
  await expect(
    page.getByLabel("Table minimum ($)", { exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel(/starting chips/i)).toHaveCount(0);
  await expect(page.getByLabel("Bot roll delay (seconds)")).toHaveCount(0);
  await expect(page.getByLabel("Sip value ($)", { exact: true })).toHaveValue(
    "5",
  );
  await openAdminSection(page, "Players");
  await expect(
    page.getByRole("button", { name: "Add bot", exact: true }),
  ).toHaveCount(0);
  await expect(page.locator(".ha-roster")).not.toContainText("Ruby");
  await openAdminSection(page, "Table");
  await drinkingMode.click();
  await page.getByLabel("Starting chips ($)", { exact: true }).fill("2500");
  await page.getByLabel("Table minimum ($)", { exact: true }).fill("10");
  await page.getByLabel("Come-out window (seconds)").fill("12");
  await page.getByLabel("Point-on window (seconds)").fill("7");
  await page.getByLabel("Bot roll delay (seconds)").fill("7");
  await openAdminSection(page, "Players");
  await page.getByRole("button", { name: "Add bot", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Open the table", exact: true }),
  ).toHaveCount(0);
  await page.getByLabel("Bot name", { exact: true }).fill("Gus");
  await page
    .getByRole("button", { name: "Press & collect", exact: true })
    .click();
  await page.getByRole("button", { name: "Advanced", exact: true }).click();
  await page.screenshot({
    path: "artifacts/admin-ux/add-bot-375.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Add to table", exact: true }).click();
  await expect(page.locator(".ha-roster")).toContainText("Gus");
  await expect(page.locator(".ha-roster")).toContainText(
    "Press & collect · Advanced",
  );
  const add = await page.evaluate(() =>
    window.adminQA.actions.find((action) => action.type === "add-bot"),
  );
  assert.deepEqual(add, {
    type: "add-bot",
    name: "Gus",
    strategy: "press",
    difficulty: "expert",
  });
  await page
    .locator(".ha-disclosure>summary")
    .filter({ hasText: "Pass host controls" })
    .click();
  const hostChoices = await page
    .getByLabel("Pass host controls", { exact: true })
    .locator("option")
    .allTextContents();
  assert.deepEqual(hostChoices, ["Choose a player", "Blair"]);
  await page.getByRole("button", { name: "Remove Ruby", exact: true }).click();
  await expect(page.locator(".ha-roster")).not.toContainText("Ruby");
  await page
    .getByRole("button", { name: "Open the table", exact: true })
    .click();
  const start = await page.evaluate(() =>
    window.adminQA.actions.find((action) => action.type === "start"),
  );
  assert.deepEqual(start.config, {
    drinkingMode: false,
    startingBank: 250000,
    minBet: 1000,
    mode: "craps",
    teach: false,
    rollCooldownSeconds: 12,
    pointRollCooldownSeconds: 7,
    botRollDelaySeconds: 7,
  });
  await openAdminSection(page, "TV", { graphics: true });
  await page.getByRole("button", { name: "Table audio", exact: true }).click();
  assert(
    await page.evaluate(() =>
      window.adminQA.actions.some((action) => action.display === "table-audio"),
    ),
  );
  await expect(page.getByLabel("TV graphics frame rate")).toHaveValue("auto");
  await page.getByLabel("TV graphics frame rate").selectOption("30");
  await expect(page.getByLabel("TV graphics frame rate")).toHaveValue("30");
  await expect(page.locator(".ha-graphics-grid select")).toHaveCount(8);
  await page.screenshot({
    path: "artifacts/admin-ux/tv-375.png",
    fullPage: true,
  });
  for (const width of [375, 320]) {
    await page.setViewportSize({ width, height: 667 });
    for (const tab of ["Table", "Players", "TV"]) {
      await openAdminSection(page, tab);
      const layout = await page.evaluate(() => ({
        window: innerWidth,
        body: document.documentElement.scrollWidth,
        inputs: [
          ...document.querySelectorAll(
            '.ha-panel input:not([type="checkbox"]),.ha-panel select',
          ),
        ]
          .filter((el) => el.getClientRects().length)
          .map((el) => parseFloat(getComputedStyle(el).fontSize)),
      }));
      assert(
        layout.body <= layout.window,
        `${tab}: no horizontal overflow at${width}px`,
      );
      assert(
        layout.inputs.every((size) => size >= 16),
        "Fields avoid automatic phone zoom",
      );
    }
  }
  await openAdminSection(page, "Players");
  await page.evaluate(() => window.adminQA.full());
  await expect(
    page.getByRole("button", { name: "Table full (12/12)", exact: true }),
  ).toBeDisabled();
  await page.evaluate(() => window.adminQA.playing());
  await page.getByRole("button", { name: "Adjust chips for Blair" }).click();
  await page.getByLabel("Amount ($)", { exact: true }).fill("25.35");
  await page.getByRole("button", { name: "Add chips", exact: true }).click();
  const bankroll = page.locator(".ha-bankroll-editor");
  await expect(bankroll.getByText("$1,025.35 available")).toBeVisible();
  await page.getByLabel("Adjustment", { exact: true }).selectOption("remove");
  const withdraw = page.getByRole("button", {
    name: "Remove chips",
    exact: true,
  });
  await page.getByLabel("Amount ($)", { exact: true }).fill("2000");
  await expect(withdraw).toBeDisabled();
  await page.getByLabel("Amount ($)", { exact: true }).fill("40.50");
  await page.evaluate(() => window.adminQA.rolling(true));
  await expect(withdraw).toBeDisabled();
  await page.evaluate(() => window.adminQA.rolling(false));
  await withdraw.click();
  await expect(bankroll.getByText("$984.85 available")).toBeVisible();
  assert.deepEqual(
    await page.evaluate(() =>
      window.adminQA.actions
        .filter((action) => action.type === "adjust-bankroll")
        .map((action) => action.amount),
    ),
    [2535, -4050],
  );
  await openAdminSection(page, "Table");
  await page.getByLabel("Come-out window (seconds)").fill("9");
  await page.getByLabel("Point-on window (seconds)").fill("4");
  await page.getByLabel("Bot roll delay (seconds)").fill("6");
  await page.getByRole("button", { name: "Save timing", exact: true }).click();
  const timing = await page.evaluate(() =>
    window.adminQA.actions.filter((action) =>
      ["cooldown", "bot-delay"].includes(action.type),
    ),
  );
  assert.deepEqual(timing.slice(-2), [
    { type: "cooldown", seconds: 9, pointSeconds: 4 },
    { type: "bot-delay", seconds: 6 },
  ]);
  await page.evaluate(() => window.adminQA.drinking());
  const savePrices = page.getByRole("button", {
    name: "Save drink prices",
    exact: true,
  });
  await expect(
    page.getByRole("group", { name: "Drink prices", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Bot roll delay (seconds)")).toHaveCount(0);
  await expect(savePrices).toBeDisabled();
  await page.getByLabel("Sip value ($)", { exact: true }).fill("7.25");
  await page
    .getByLabel("Drink assignment markup (%)", { exact: true })
    .fill("20");
  await page.getByLabel(/Enable .Finish drink./).check();
  await page.getByLabel("Finish drink value ($)", { exact: true }).fill("60");
  await page.evaluate(() => window.adminQA.rolling(true));
  await expect(savePrices).toBeDisabled();
  await page.evaluate(() => window.adminQA.rolling(false));
  await savePrices.click();
  assert.deepEqual(
    await page.evaluate(() =>
      window.adminQA.actions.find((action) => action.type === "drinking-rules"),
    ),
    {
      type: "drinking-rules",
      rules: {
        sipValue: 725,
        shotValue: 10000,
        finishValue: 6000,
        finishEnabled: true,
        offerMarkup: 20,
      },
    },
  );
  await expect(savePrices).toBeDisabled();
  await expect(page.getByLabel("Sip value ($)", { exact: true })).toHaveValue(
    "7.25",
  );
  await page.screenshot({
    path: "artifacts/admin-ux/drink-prices-320.png",
    fullPage: true,
  });
  assert.deepEqual(errors, []);
  const report = {
    widths: [375, 320],
    checks: [
      "shared lobby/live host controls",
      "rule drafts survive bot/TV tabs",
      "named strategy/difficulty payload",
      "human-only host transfer",
      "bot removal and12-seat capacity",
      "separate come-out, point-on and bot delays",
      "all eight graphics controls",
      "table minimum first, bots hidden in drinking setup",
      "host audio entry and live drink pricing with roll guard",
      "live chip additions and withdrawals scoped to available balance",
      "no horizontal overflow or sub16px fields",
    ],
    errors,
  };
  await writeFile(
    "artifacts/admin-ux/report.json",
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report));
} finally {
  await browser?.close();
  await server.close();
}
