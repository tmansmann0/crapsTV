import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { chromium, expect } from "@playwright/test";
const root = fileURLToPath(new URL("../", import.meta.url));
const record = process.argv.includes("--before");
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
let browser;
const reports = [];
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
  await mkdir(`${root}/artifacts`, { recursive: true });
  for (const [width, height] of [
    [390, 844],
    [375, 640],
  ]) {
    const page = await browser.newPage({ viewport: { width, height } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.route("**/__layout-test", (r) =>
      r.fulfill({
        contentType: "text/html",
        body: '<html><head><style>html,body,#root{margin:0;width:100%;height:100%;overflow:hidden}</style></head><body><div id="root"></div><script type="module" src="/tests/fixtures/phone-odds.jsx"></script></body></html>',
      }),
    );
    await page.goto(
      `http://127.0.0.1:${server.httpServer.address().port}/__layout-test`,
    );
    await page.evaluate(() => document.fonts.ready);
    const samples = [];
    async function capture(name) {
      await page.evaluate(
        () =>
          new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve)),
          ),
      );
      const bounds = await page.evaluate(() => {
        const rect = (selector) => {
          const el = document.querySelector(selector);
          if (!el) return null;
          const r = el.getBoundingClientRect();
          return { x: r.x, y: r.y, width: r.width, height: r.height };
        };
        return {
          felt: rect(".pg-felt"),
          board: rect(".pg-board"),
          rack: rect(".pg-rack"),
          strip: rect(".pg-strip"),
          pass: rect('[data-bet-id="pass"]'),
          quick: rect(".pg-quickbets"),
          notice: rect(".pg-notice"),
          minTap: Math.min(
            ...[
              ...document.querySelectorAll(
                ".pg-board [data-bet-id],.pg-rack button,.pg-board-switch button",
              ),
            ]
              .filter((e) => e.getBoundingClientRect().height > 0)
              .map((e) => e.getBoundingClientRect().height),
          ),
          overflow: document.documentElement.scrollWidth > innerWidth,
        };
      });
      samples.push({ name, ...bounds });
    }
    await capture("initial");
    await page
      .getByRole("button", { name: "Add $1 chip", exact: true })
      .click();
    await capture("add-chip");
    await page
      .getByRole("button", { name: "Remove last chip", exact: true })
      .click();
    await capture("remove-chip");
    await page.locator('[data-bet-id="pass"]').click();
    await capture("select-pass");
    await page.locator('[data-bet-id="pass"]').click();
    await capture("deselect-pass");
    await page.locator('[data-bet-id="place-6"]').click();
    await capture("select-place6");
    await page.getByRole("button", { name: "Place $5", exact: false }).click();
    await capture("validation");
    await page.screenshot({
      path: `${root}/artifacts/phone-layout-${record ? "before" : "after"}-validation-${width}.png`,
    });
    const fix = page.getByRole("button", { name: /Bet more: \$6/ });
    await expect(fix).toBeVisible();
    await fix.click();
    await expect(page.locator(".pg-notice")).toContainText("Placed $6");
    await capture("success");
    await page.waitForTimeout(2700);
    await capture("success-cleared");
    await page.evaluate(() => window.oddsFixture.teach(true));
    await page.locator('[data-bet-id="place-6"]').click();
    await capture("teach-selected");
    await page.evaluate(() =>
      window.oddsFixture.error(
        "This is an intentionally long connection error explaining that the bet could not be placed. Please check the amount and reconnect before trying again.",
      ),
    );
    await capture("long-error");
    await page.evaluate(() => window.oddsFixture.error(""));
    await page.evaluate(() =>
      window.oddsFixture.reset({ point: 4, hasLine: true }),
    );
    await capture("point-odds");
    await page.screenshot({
      path: `${root}/artifacts/phone-layout-${record ? "before" : "after"}-odds-${width}.png`,
    });
    await page.evaluate(() => window.oddsFixture.placeOdds(600));
    await capture("odds-stake");
    await page.evaluate(() => window.oddsFixture.finishPoint());
    await page.waitForTimeout(2700);
    await capture("point-resolved");
    await page.evaluate(() => window.oddsFixture.reset({ bank: 0 }));
    await capture("bust-reup");
    const ys = samples.map((s) => s.felt.y),
      hs = samples.map((s) => s.felt.height);
    const report = {
      width,
      height,
      maxTopShift: Math.max(...ys) - Math.min(...ys),
      maxHeightShift: Math.max(...hs) - Math.min(...hs),
      samples,
    };
    reports.push(report);
    if (!record) {
      assert(
        report.maxTopShift <= 1,
        `board top shifts ${report.maxTopShift}px at ${width}`,
      );
      assert(
        report.maxHeightShift <= 1,
        `board height shifts ${report.maxHeightShift}px at ${width}`,
      );
      assert(
        samples.every((s) => !s.overflow),
        "no horizontal overflow",
      );
      assert(
        samples.every((s) => s.minTap >= 43.5),
        `44px targets: ${JSON.stringify(samples.map((s) => [s.name, s.minTap]))}`,
      );
      assert(
        samples.every(
          (s) => s.board.y + s.board.height <= s.felt.y + s.felt.height + 0.5,
        ),
        "entire board fits its viewport",
      );
      assert.deepEqual(errors, []);
    }
    console.log(
      `${width}x${height}: board top variation ${report.maxTopShift.toFixed(1)}px; height variation ${report.maxHeightShift.toFixed(1)}px`,
    );
    await page.close();
  }
  await writeFile(
    `${root}/artifacts/phone-layout-${record ? "before" : "after"}.json`,
    JSON.stringify(reports, null, 2),
  );
} finally {
  await browser?.close();
  await server.close();
}
