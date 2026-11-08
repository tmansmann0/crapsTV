import { createServer } from "vite";
import { chromium } from "@playwright/test";
import { mkdir, writeFile, copyFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import assert from "node:assert/strict";
import { pngDifference } from "./png-difference.mjs";
import { REFLECTION_FINISHES } from "../src/reflection-finish.js";
const run = promisify(execFile);
const server = await createServer({
  configFile: false,
  appType: "custom",
  cacheDir: "artifacts/vite-reflection-strength-cache",
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
  if (req.url.startsWith("/__reflection-strength")) {
    res.setHeader("content-type", "text/html");
    res.end(
      '<script type="module" src="/scripts/qa/effects-study-view.js"></script>',
    );
  } else next();
});
const output = "public/studies/reflections";
let browser;
const errors = [],
  report = {
    finishes: REFLECTION_FINISHES,
    comparisons: [],
    captures: [],
    errors,
  };
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
    `http://127.0.0.1:${server.httpServer.address().port}/__reflection-strength`,
  );
  await page.waitForFunction(
    () => window.effectsStudy?.ready,
    {},
    { timeout: 90000 },
  );
  await mkdir(output, { recursive: true });
  await mkdir("artifacts/reflection-strength", { recursive: true });
  for (const shot of ["macro", "dice"]) {
    const images = {};
    for (const profile of [
      "off",
      "current",
      "medium",
      "polished",
      "restored",
    ]) {
      const result = await page.evaluate(
        ([shot, profile]) => window.effectsStudy.captureStrength(shot, profile),
        [shot, profile === "restored" ? "off" : profile],
      );
      images[profile] = Buffer.from(result.image.split(",")[1], "base64");
      delete result.image;
      const raw = `artifacts/reflection-strength/${shot}-${profile}.png`;
      await writeFile(raw, images[profile]);
      if (profile !== "restored" && process.env.REFLECTION_STUDY_RAW !== "1")
        await run("cwebp", [
          "-quiet",
          "-lossless",
          "-z",
          "3",
          raw,
          "-o",
          `${output}/${shot}-${profile}.webp`,
        ]);
      report.captures.push(result);
      console.log(
        JSON.stringify({ shot, profile, state: result.reflections.state }),
      );
    }
    assert.equal(
      pngDifference(images.off, images.restored).changedPixels,
      0,
      "Off restoration is pixel exact",
    );
    for (const profile of ["medium", "polished"]) {
      const diff = pngDifference(images.current, images[profile]);
      assert(diff.changedPixels > 1000);
      report.comparisons.push({ shot, profile, difference: diff });
    }
  }
  assert.deepEqual(errors, []);
  report.delivery =
    "Native3840×2160 lossless GPU captures; identical camera, lights, exposure and wear maps. Contact shadows and lens flares disabled.";
  await writeFile(
    `${output}/manifest.json`,
    JSON.stringify(report, null, 2) + "\n",
  );
} finally {
  await browser?.close();
  await server.close();
}
