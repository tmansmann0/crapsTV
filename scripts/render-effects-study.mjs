import { createServer } from "vite";
import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { pngDifference } from "./png-difference.mjs";
const server = await createServer({
  configFile: false,
  appType: "custom",
  cacheDir: "artifacts/vite-effects-study-cache",
  server: { host: "127.0.0.1", port: 0, hmr: false },
  optimizeDeps: {
    include: [
      "three",
      "three/addons/loaders/GLTFLoader.js",
      "three/addons/loaders/EXRLoader.js",
      "three/addons/objects/Lensflare.js",
    ],
  },
});
server.middlewares.use((req, res, next) => {
  if (req.url.startsWith("/__effects-study")) {
    res.setHeader("content-type", "text/html");
    res.end(
      '<script type="module" src="/scripts/qa/effects-study-view.js"></script>',
    );
  } else next();
});
let browser;
const errors = [],
  report = { captures: [], errors };
const folder = process.env.EFFECTS_STUDY_OUTPUT || "public/studies/effects";
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
  const page = await browser.newPage({
    viewport: { width: 3840, height: 2160 },
  });
  page.on("pageerror", (e) => errors.push(e.stack || e.message));
  page.on("console", (m) => {
    if (m.type() === "error" || /GL_INVALID|INVALID_OPERATION/.test(m.text()))
      errors.push(m.text());
  });
  await page.goto(
    `http://127.0.0.1:${server.httpServer.address().port}/__effects-study`,
  );
  await page.waitForFunction(
    () => window.effectsStudy?.ready,
    {},
    { timeout: 90000 },
  );
  await mkdir(folder, { recursive: true });
  for (const shot of ["macro", "lamp"]) {
    const images = {};
    for (const mode of [
      "off",
      "on",
      "reflections",
      "shadows",
      "flares",
      "restored",
    ]) {
      const result = await page.evaluate(
        ([shot, mode]) => window.effectsStudy.capture(shot, mode),
        [shot, mode === "restored" ? "off" : mode],
      );
      images[mode] = Buffer.from(result.image.split(",")[1], "base64");
      delete result.image;
      await writeFile(`${folder}/${shot}-${mode}.png`, images[mode]);
      report.captures.push(result);
      console.log(
        JSON.stringify({
          shot,
          mode,
          flareSources: result.flareSources,
          probe: result.reflections.state,
        }),
      );
    }
    const difference = pngDifference(images.off, images.on);
    const restore = pngDifference(images.off, images.restored);
    report[shot] = { difference, restore };
    assert(difference.changedPixels > 1000);
    assert.equal(restore.changedPixels, 0);
  }
  assert.deepEqual(errors, []);
  await writeFile(`${folder}/manifest.json`, JSON.stringify(report, null, 2));
} finally {
  await browser?.close();
  await server.close();
}
