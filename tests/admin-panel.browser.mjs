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
  await mkdir("artifacts/admin-ux", { recursive: true });
  await page.screenshot({
    path: "artifacts/admin-ux/table-375.png",
    fullPage: true,
  });
  await page.getByLabel("Starting chips ($)", { exact: true }).fill("2500");
  await page.getByLabel("Table minimum ($)", { exact: true }).fill("10");
  await page.getByLabel("Betting window (seconds)").fill("12");
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
    startingBank: 250000,
    minBet: 1000,
    mode: "craps",
    teach: false,
    rollCooldownSeconds: 12,
    botRollDelaySeconds: 7,
  });
  await openAdminSection(page, "TV", { graphics: true });
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
  await openAdminSection(page, "Table");
  await page.getByLabel("Betting window (seconds)").fill("9");
  await page.getByLabel("Bot roll delay (seconds)").fill("6");
  await page.getByRole("button", { name: "Save timing", exact: true }).click();
  const timing = await page.evaluate(() =>
    window.adminQA.actions.filter((action) =>
      ["cooldown", "bot-delay"].includes(action.type),
    ),
  );
  assert.deepEqual(timing.slice(-2), [
    { type: "cooldown", seconds: 9 },
    { type: "bot-delay", seconds: 6 },
  ]);
  assert.deepEqual(errors, []);
  const report = {
    widths: [375, 320],
    checks: [
      "shared lobby/live host controls",
      "rule drafts survive bot/TV tabs",
      "named strategy/difficulty payload",
      "human-only host transfer",
      "bot removal and12-seat capacity",
      "bot delay and live total",
      "all eight graphics controls",
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
