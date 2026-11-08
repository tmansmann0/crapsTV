import { createServer } from "vite";
import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { pngDifference } from "./png-difference.mjs";
const server = await createServer({
  configFile: false,
  cacheDir: "artifacts/vite-local-reflection-cache",
  appType: "custom",
  server: { host: "127.0.0.1", port: 0, hmr: false },
  optimizeDeps: {
    include: [
      "three",
      "three/addons/loaders/GLTFLoader.js",
      "three/addons/loaders/EXRLoader.js",
    ],
  },
});
server.middlewares.use((req, res, next) => {
  if (req.url === "/__local-reflections") {
    res.setHeader("content-type", "text/html");
    res.end(
      '<script type="module" src="/scripts/qa/local-reflections-view.js"></script>',
    );
  } else next();
});
let browser;
const errors = [];
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
    viewport: { width: 1920, height: 1080 },
  });
  page.on("pageerror", (e) => errors.push(e.stack || e.message));
  page.on("console", (m) => {
    if (
      m.type() === "error" ||
      /GL_INVALID|INVALID_OPERATION|INVALID_VALUE/.test(m.text())
    )
      errors.push(m.text());
  });
  await page.goto(
    `http://127.0.0.1:${server.httpServer.address().port}/__local-reflections`,
  );
  await page.waitForFunction(
    () => window.localReflectionProof?.ready,
    {},
    { timeout: 90000 },
  );
  const result = await page.evaluate(() =>
    window.localReflectionProof.exercise(),
  );
  await mkdir("artifacts/local-reflections", { recursive: true });
  const images = {};
  for (const name of ["off", "on", "warm", "restored"]) {
    images[name] = Buffer.from(result[name].image.split(",")[1], "base64");
    await writeFile(`artifacts/local-reflections/${name}.png`, images[name]);
    delete result[name].image;
  }
  result.effect = pngDifference(images.off, images.on);
  result.restoredPixels = pngDifference(images.off, images.restored);
  assert.equal(result.off.estimatedBytes, 0);
  assert.equal(result.cancelled.commits, 0);
  assert.equal(result.cancelled.faces, 0);
  assert.equal(result.on.commits, 1);
  assert.equal(result.warm.commits, 2);
  assert.equal(result.stable.captureDraws, result.on.captureDraws);
  assert(
    result.effect.changedPixels > 1000,
    "real local reflections change visible PBR pixels",
  );
  assert.equal(
    result.restoredPixels.changedPixels,
    0,
    "Off restores exact original pixels",
  );
  assert.equal(
    result.restored.textures,
    result.off.textures,
    "Off frees all reflection GPU textures",
  );
  assert.equal(
    result.restored.geometries,
    result.off.geometries,
    "Off frees reflection geometry buffers",
  );
  result.late = await page.evaluate(() => window.localReflectionProof.late());
  assert(
    result.late.registered > 0 && result.late.assigned && result.late.reset,
  );
  assert.deepEqual(errors, []);
  result.errors = errors;
  await page.evaluate(() => window.localReflectionProof.dispose());
  await writeFile(
    "artifacts/local-reflections/report.json",
    JSON.stringify(result, null, 2) + "\n",
  );
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser?.close();
  await server.close();
}
