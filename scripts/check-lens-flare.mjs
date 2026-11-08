import { createServer } from "vite";
import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { PNG } from "pngjs";
import { pngDifference } from "./png-difference.mjs";

const server = await createServer({
  configFile: false,
  cacheDir: "artifacts/vite-lens-flare-cache",
  appType: "custom",
  server: { host: "127.0.0.1", port: 0, hmr: false },
  optimizeDeps: { include: ["three", "three/addons/objects/Lensflare.js"] },
});
server.middlewares.use((request, response, next) => {
  if (request.url.startsWith("/__lens-flare")) {
    response.setHeader("content-type", "text/html");
    response.end(
      '<script type="module" src="/scripts/qa/lens-flare-view.js"></script>',
    );
  } else next();
});
let browser;
const errors = [],
  report = { errors, comparisons: [] };
const imageBytes = (image) => Buffer.from(image.split(",")[1], "base64");
function uiPixels(bytes) {
  const image = PNG.sync.read(bytes);
  const pixels = [];
  for (let y = 320; y < 420; y++)
    for (let x = 560; x < 880; x++) {
      const i = (y * image.width + x) * 4;
      pixels.push(...image.data.subarray(i, i + 4));
    }
  return Buffer.from(pixels);
}
try {
  await server.listen();
  browser = await chromium.launch({
    headless: true,
    args: [
      `--use-angle=${process.platform === "darwin" ? "metal" : "swiftshader"}`,
      "--enable-webgl",
      "--ignore-gpu-blocklist",
    ],
  });
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
  page.on("pageerror", (error) => errors.push(error.stack || error.message));
  page.on("console", (message) => {
    if (
      message.type() === "error" ||
      /GL_INVALID|INVALID_OPERATION/.test(message.text())
    )
      errors.push(message.text());
  });
  await page.goto(
    `http://127.0.0.1:${server.httpServer.address().port}/__lens-flare`,
  );
  await page.waitForFunction(() => window.lensFlarePreview?.ready);
  await mkdir("artifacts/lens-flare", { recursive: true });
  const capture = (options) =>
    page.evaluate((value) => window.lensFlarePreview.capture(value), options);
  for (const split of [false, true]) {
    for (const [location, obstruction] of [
      ["visible", "none"],
      ["visible", "table"],
      ["visible", "chip"],
      ["offscreen", "none"],
      ["behind", "none"],
    ]) {
      const options = { split, location, obstruction };
      const before = await capture({ ...options, enabled: false });
      const after = await capture({ ...options, enabled: true });
      const restored = await capture({ ...options, enabled: false });
      const effect = pngDifference(
        imageBytes(before.image),
        imageBytes(after.image),
      );
      const name = `${split ? "scaled" : "native"}-${location}-${obstruction}`;
      await writeFile(
        `artifacts/lens-flare/${name}-off.png`,
        imageBytes(before.image),
      );
      await writeFile(
        `artifacts/lens-flare/${name}-on.png`,
        imageBytes(after.image),
      );
      assert.equal(after.split, split);
      if (location === "visible" && obstruction === "none") {
        assert(
          effect.changedPixels > 100,
          "visible lamp creates a restrained flare",
        );
        assert(
          effect.maxChannelDifference <= 32,
          "the optical pass stays subtle without shifting the restored lamp image",
        );
        assert(
          after.textures > before.textures,
          "enabled effect owns its temporary GPU textures",
        );
      } else
        assert.equal(
          effect.changedPixels,
          0,
          `${name}: occluded/hidden source cannot create a flare`,
        );
      assert.equal(
        pngDifference(imageBytes(before.image), imageBytes(restored.image))
          .changedPixels,
        0,
        "Off restores exact original pixels",
      );
      assert.equal(
        restored.textures,
        before.textures,
        "Off releases all flare textures",
      );
      assert.equal(
        restored.geometries,
        before.geometries,
        "Off releases flare geometry buffers",
      );
      assert.deepEqual(
        uiPixels(imageBytes(before.image)),
        uiPixels(imageBytes(after.image)),
        "UI text and QR pixels remain exact",
      );
      const { image: beforeImage, ...beforeMetrics } = before;
      const { image: afterImage, ...afterMetrics } = after;
      report.comparisons.push({
        name,
        before: beforeMetrics,
        after: afterMetrics,
        effect,
      });
    }
  }
  assert.deepEqual(errors, []);
  await writeFile(
    "artifacts/lens-flare/report.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser?.close();
  await server.close();
}
