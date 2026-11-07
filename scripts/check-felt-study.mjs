import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "vite";
import { chromium, expect } from "@playwright/test";

const server = await createServer({
  configFile: false,
  appType: "custom",
  server: { host: "127.0.0.1", port: 0, hmr: false },
});
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    viewport: { width: 1920, height: 1000 },
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("response", (r) => {
    if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`);
  });
  await page.goto(
    `http://127.0.0.1:${server.httpServer.address().port}/studies/felt/index.html`,
  );
  const images = page.locator("main img");
  await expect(images).toHaveCount(3);
  const ready = () =>
    page.waitForFunction(() =>
      [...document.querySelectorAll("main img")].every(
        (image) =>
          image.complete &&
          image.naturalWidth === 3840 &&
          image.naturalHeight === 2160,
      ),
    );
  await ready();
  await mkdir("artifacts", { recursive: true });
  await page.screenshot({
    path: "artifacts/felt-options-comparison.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Inspect Soft fibres at full resolution" })
    .click();
  await expect(page.locator("dialog")).toBeVisible();
  await page.getByRole("button", { name: "View 1:1 pixels" }).click();
  assert.equal(
    await page
      .locator(".viewport img")
      .evaluate((image) => image.getBoundingClientRect().width),
    3840,
  );
  await page.getByRole("button", { name: "Close image", exact: true }).click();
  await page
    .getByRole("button", { name: "Table distance", exact: true })
    .click();
  await ready();
  assert(
    (
      await images.evaluateAll((nodes) =>
        nodes.map((image) => image.getAttribute("src")),
      )
    ).every((source) => source.includes("wide-")),
  );
  await page.screenshot({
    path: "artifacts/felt-options-wide-comparison.png",
    fullPage: true,
  });
  assert.deepEqual(errors, []);
  const report = {
    options: 3,
    shots: 2,
    imageSize: [3840, 2160],
    nativeZoom: true,
    errors,
  };
  await writeFile(
    "artifacts/felt-options-viewer.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report));
} finally {
  await browser?.close();
  await server.close();
}
