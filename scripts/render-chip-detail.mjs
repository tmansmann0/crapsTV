import { createServer } from "vite";
import { chromium } from "@playwright/test";
import { writeFile, mkdir, readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { PNG } from "pngjs";
const phase = process.argv[2] || "after",
  errors = [];
const server = await createServer({
  configFile: false,
  appType: "custom",
  server: { host: "127.0.0.1", port: 0, hmr: false },
  optimizeDeps: {
    include: [
      "three",
      "three/addons/loaders/EXRLoader.js",
      "three/addons/loaders/GLTFLoader.js",
    ],
  },
});
server.middlewares.use((q, r, n) => {
  if (q.url.startsWith("/__chip-detail")) {
    r.setHeader("content-type", "text/html");
    r.end(
      '<script type="module" src="/scripts/qa/chip-detail-view.js"></script>',
    );
  } else n();
});
let browser;
try {
  await server.listen();
  browser = await chromium.launch({
    headless: true,
    args: [
      `--use-angle=${process.env.MATERIAL_STUDY_ANGLE || (process.platform === "darwin" ? "metal" : "swiftshader")}`,
      "--enable-webgl",
      "--ignore-gpu-blocklist",
    ],
  });
  const page = await browser.newPage({
    viewport: { width: 3840, height: 2160 },
  });
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error" || /GL_INVALID|INVALID_OPERATION/.test(m.text()))
      errors.push(m.text());
  });
  const diagnostics = process.argv.includes("--diagnostics");
  const frontal = process.argv.includes("--frontal");
  if (!diagnostics)
    await page.goto(
      `http://127.0.0.1:${server.httpServer.address().port}/__chip-detail${frontal ? "?orange=1&frontal=1" : ""}`,
    );
  if (!diagnostics)
    await page.waitForFunction(
      () => window.proof?.ready,
      {},
      { timeout: 60000 },
    );
  await mkdir("artifacts", { recursive: true });
  const views = [];
  if (diagnostics)
    for (const diagnostic of [
      "lit",
      "no-patina",
      "no-normals",
      "flat-albedo",
    ]) {
      await page.goto(
        `http://127.0.0.1:${server.httpServer.address().port}/__chip-detail?orange=1&diagnostic=${diagnostic}`,
      );
      await page.waitForFunction(
        () => window.proof?.ready,
        {},
        { timeout: 60000 },
      );
      const result = await page.evaluate(() =>
        window.proof.capture("native", 0),
      );
      const image = await page.evaluate(() => window.proof.image());
      const file = `artifacts/chip-band-${phase}-${diagnostic}.png`;
      await writeFile(file, Buffer.from(image.split(",")[1], "base64"));
      views.push({ ...result, diagnostic, file });
    }
  else
    for (const limit of ["native", "1k"])
      for (const flip of frontal ? [0] : [0, 1]) {
        const result = await page.evaluate(
          ([l, f]) => window.proof.capture(l, f),
          [limit, flip],
        );
        const image = await page.evaluate(() => window.proof.image());
        const file = `artifacts/chip-${frontal ? "frontal" : "detail"}-${phase}-${limit}-${flip}.png`;
        await writeFile(file, Buffer.from(image.split(",")[1], "base64"));
        views.push({ ...result, file });
      }
  const capPixelParity = [];
  if (phase === "after") {
    for (const view of views) {
      assert.deepEqual(view.drawBuffer, [3840, 2160]);
      for (const stamp of view.stamps) {
        assert.deepEqual(stamp.color, [2048, 2048]);
        assert.deepEqual(stamp.normal, [2048, 2048]);
        assert.equal(stamp.criticalMinimum, 2048);
      }
    }
    if (!diagnostics)
      for (const flip of frontal ? [0] : [0, 1]) {
        const pair = views.filter((v) => v.flip === flip);
        const a = PNG.sync.read(
          await readFile(pair.find((v) => v.limit === "native").file),
        );
        const b = PNG.sync.read(
          await readFile(pair.find((v) => v.limit === "1k").file),
        );
        let total = 0,
          changed = 0;
        for (let i = 0; i < a.data.length; i++) {
          const delta = Math.abs(a.data[i] - b.data[i]);
          total += delta;
          if (delta) changed++;
        }
        const mean = total / a.data.length;
        assert(
          mean < 0.001,
          "critical logo must retain rendered detail under a 1K scene texture cap",
        );
        capPixelParity.push({
          flip,
          meanChannelDifference: mean,
          changedChannels: changed,
        });
      }
  }
  const report = { phase, views, capPixelParity, errors };
  await writeFile(
    `artifacts/${diagnostics ? "chip-band" : frontal ? "chip-frontal" : "chip-detail"}-${phase}.json`,
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report));
  if (errors.length) process.exitCode = 1;
} finally {
  await browser?.close();
  await server.close();
}
