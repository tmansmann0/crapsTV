import { createServer } from "vite";
import { chromium, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
const server = await createServer({
  configFile: false,
  cacheDir: "artifacts/vite-effects-gallery-cache",
  server: { host: "127.0.0.1", port: 0, hmr: false },
});
let browser;
const errors = [],
  report = { cases: [], errors };
try {
  await server.listen();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    viewport: { width: 2560, height: 1440 },
  });
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("response", (r) => {
    if (r.status() >= 400) errors.push(`${r.status()}: ${r.url()}`);
  });
  await page.goto(
    `http://127.0.0.1:${server.httpServer.address().port}/studies/effects/index.html`,
  );
  async function loaded() {
    await page.waitForFunction(() =>
      [...document.querySelectorAll(".viewport img")].every(
        (i) =>
          i.complete && i.naturalWidth === 3840 && i.naturalHeight === 2160,
      ),
    );
  }
  await mkdir("artifacts", { recursive: true });
  for (const shot of ["macro", "lamp"]) {
    await page.locator(`[data-shot="${shot}"]`).click();
    for (const mode of [
      "on",
      "reflections",
      "shadows",
      "flares",
      "flares-original",
    ]) {
      await page.locator("#effect").selectOption(mode);
      await loaded();
      report.cases.push({
        shot,
        mode,
        images: await page
          .locator(".viewport img")
          .evaluateAll((imgs) =>
            imgs.map((i) => ({
              source: i.getAttribute("src"),
              width: i.naturalWidth,
              height: i.naturalHeight,
            })),
          ),
      });
    }
    await page.locator("#effect").selectOption("on");
    await loaded();
    await page
      .locator(".pair")
      .screenshot({ path: `artifacts/effects-${shot}-comparison.png` });
  }
  await page.locator('[data-zoom="2"]').click();
  await page
    .locator(".viewport")
    .first()
    .hover({ position: { x: 150, y: 180 } });
  const transforms = await page
    .locator(".viewport img")
    .evaluateAll((imgs) =>
      imgs.map((i) => ({
        transform: getComputedStyle(i).transform,
        origin: getComputedStyle(i).transformOrigin,
      })),
    );
  assert.deepEqual(transforms[0], transforms[1]);
  await page.locator("h1").click();
  await page.keyboard.down("Space");
  await loaded();
  await expect(page.locator("#after")).toHaveAttribute("src", "lamp-off.webp");
  await page.keyboard.up("Space");
  await loaded();
  await expect(page.locator("#after")).toHaveAttribute("src", "lamp-on.webp");
  await page.setViewportSize({ width: 390, height: 844 });
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  assert.deepEqual(errors, []);
  report.zoomMatched = true;
  report.spaceComparison = true;
  report.mobileOverflow = false;
  await writeFile(
    "artifacts/effects-gallery-report.json",
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report));
} finally {
  await browser?.close();
  await server.close();
}
