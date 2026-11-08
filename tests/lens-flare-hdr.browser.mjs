import { createServer } from "vite";
import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { PNG } from "pngjs";
import { pngDifference } from "../scripts/png-difference.mjs";

const server = await createServer({
  configFile: false,
  appType: "custom",
  cacheDir: "artifacts/vite-lens-flare-hdr-cache",
  server: { host: "127.0.0.1", port: 0, hmr: false },
  optimizeDeps: {
    include: [
      "three",
      "three/addons/objects/Lensflare.js",
      "three/addons/loaders/EXRLoader.js",
    ],
  },
});
server.middlewares.use((request, response, next) => {
  if (request.url.startsWith("/__hdr-flare")) {
    response.setHeader("content-type", "text/html");
    response.end(
      '<script type="module" src="/tests/fixtures/lens-flare-hdr.js"></script>',
    );
  } else next();
});
let browser;
const errors = [],
  report = { cases: [], errors };
const folder = "artifacts/lens-flare-hdr";
const bytes = (value) => Buffer.from(value.image.split(",")[1], "base64");
function visibleHalo(before, after) {
  const a = PNG.sync.read(before),
    b = PNG.sync.read(after);
  let outsideWhiteMax = 0,
    clearlyChangedPixels = 0,
    darkenedChannels = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    const white = a.data[i] > 220 && a.data[i + 1] > 220 && a.data[i + 2] > 210;
    let peak = 0;
    for (let c = 0; c < 3; c++) {
      const difference = b.data[i + c] - a.data[i + c];
      peak = Math.max(peak, difference);
      if (difference < 0) darkenedChannels++;
    }
    if (!white) outsideWhiteMax = Math.max(outsideWhiteMax, peak);
    if (peak >= 8) clearlyChangedPixels++;
  }
  return { outsideWhiteMax, clearlyChangedPixels, darkenedChannels };
}
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
  const page = await browser.newPage({
    viewport: { width: 1920, height: 1080 },
  });
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (/GL_INVALID|INVALID_OPERATION|INVALID_VALUE/.test(message.text()))
      errors.push(message.text());
  });
  await page.goto(
    `http://127.0.0.1:${server.httpServer.address().port}/__hdr-flare`,
  );
  await page.waitForFunction(
    () => window.hdrFlare?.ready,
    {},
    { timeout: 90000 },
  );
  await mkdir(folder, { recursive: true });
  for (const split of [false, true])
    for (const obstruction of ["none", "table", "chip"]) {
      const options = { split, obstruction };
      const capture = (enabled) =>
        page.evaluate((options) => window.hdrFlare.capture(options), {
          ...options,
          enabled,
        });
      const before = await capture(false),
        after = await capture(true),
        restored = await capture(false);
      const effect = pngDifference(bytes(before), bytes(after));
      const halo = visibleHalo(bytes(before), bytes(after));
      const name = `${split ? "scaled" : "native"}-${obstruction}`;
      if (obstruction === "none") {
        assert.equal(after.active, 1);
        assert(
          halo.clearlyChangedPixels > 1000,
          "real HDR lamp spreads a visible halo outside its white shade",
        );
        assert(
          halo.outsideWhiteMax >= 20 && halo.outsideWhiteMax <= 45,
          "actual lamp glow is noticeable and restrained",
        );
        assert.equal(
          halo.darkenedChannels,
          0,
          "framebuffer restoration cannot shift or darken existing lamp pixels",
        );
        await writeFile(`${folder}/${name}-off.png`, bytes(before));
        await writeFile(`${folder}/${name}-on.png`, bytes(after));
      } else
        assert.equal(
          effect.changedPixels,
          0,
          "actual HDR lamp cannot flare through table or instanced chips",
        );
      assert.equal(
        pngDifference(bytes(before), bytes(restored)).changedPixels,
        0,
      );
      assert.equal(restored.textures, before.textures);
      report.cases.push({ name, effect, halo });
    }
  assert.deepEqual(errors, []);
  await writeFile(
    `${folder}/report.json`,
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser?.close();
  await server.close();
}
