import { createServer } from "vite";
import { chromium } from "@playwright/test";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
const width = Number(process.env.SURFACE_PARITY_WIDTH) || 3840;
const height =
  Number(process.env.SURFACE_PARITY_HEIGHT) || Math.round((width * 9) / 16);
const angle =
  process.env.MATERIAL_STUDY_ANGLE ||
  (process.platform === "darwin" ? "metal" : "swiftshader");
const server = await createServer({
  configFile: false,
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
  if (req.url.startsWith("/__surface-parity")) {
    res.setHeader("content-type", "text/html");
    res.end(
      '<script type="module" src="/scripts/qa/material-look-view.js"></script>',
    );
  } else next();
});
let browser;
const errors = [],
  report = { shots: {}, errors };
try {
  await server.listen();
  browser = await chromium.launch({
    headless: true,
    args: [`--use-angle=${angle}`, "--enable-webgl", "--ignore-gpu-blocklist"],
  });
  const page = await browser.newPage({
    viewport: { width, height },
  });
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (
      m.type() === "error" ||
      /INVALID_OPERATION|INVALID_VALUE|GL_INVALID/.test(m.text())
    )
      errors.push(m.text());
  });
  await mkdir("artifacts", { recursive: true });
  for (const mode of ["reference", "production"]) {
    const query = new URLSearchParams({
      width: String(width),
      height: String(height),
    });
    if (mode === "production") query.set("production", "1");
    if (angle === "swiftshader") query.set("software", "1");
    await page.goto(
      `http://127.0.0.1:${server.httpServer.address().port}/__surface-parity?${query}`,
    );
    await page.waitForFunction(
      () => window.materialLookPreview?.ready,
      {},
      { timeout: 90000 },
    );
    if (mode === "production")
      report.shaderVariants = await page.evaluate(() =>
        window.materialLookPreview.verifyVariants(),
      );
    for (const shot of ["hero", "wide"]) {
      const metrics = await page.evaluate(
        ({ shot, width, height }) =>
          window.materialLookPreview.render("refined", shot, { width, height }),
        { shot, width, height },
      );
      assert.equal(metrics.production, mode === "production");
      assert.deepEqual(metrics.drawBuffers, [width, height]);
      const url = await page.evaluate(() =>
        window.materialLookPreview.image("image/png"),
      );
      const file = `artifacts/surface-${mode}-${shot}.png`;
      await writeFile(file, Buffer.from(url.split(",")[1], "base64"));
      report.shots[shot] ??= {};
      report.shots[shot][mode] = { ...metrics, file };
    }
  }
  for (const shot of ["hero", "wide"]) {
    const a = report.shots[shot].reference.file,
      b = report.shots[shot].production.file;
    const exact = (await readFile(a)).equals(await readFile(b));
    const pixels = JSON.parse(
      execFileSync(
        "python3",
        [
          "-c",
          `import json,sys,numpy as np\nfrom PIL import Image\na=np.asarray(Image.open(sys.argv[1]),dtype=np.int16);b=np.asarray(Image.open(sys.argv[2]),dtype=np.int16);d=np.abs(a-b)\nprint(json.dumps({'meanAbsoluteDifference':float(d.mean()),'maxChannelDifference':int(d.max()),'changedPixels':int(np.any(d!=0,axis=2).sum())}))`,
          a,
          b,
        ],
        { encoding: "utf8" },
      ),
    );
    report.shots[shot].comparison = { exactPng: exact, ...pixels };
    assert(
      pixels.meanAbsoluteDifference < 1,
      `${shot}: production must match approved refined preview`,
    );
  }
  assert.deepEqual(errors, []);
  await writeFile(
    "docs/benchmarks/surface-production-parity.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(
    JSON.stringify(
      {
        comparisons: Object.fromEntries(
          Object.entries(report.shots).map(([k, v]) => [k, v.comparison]),
        ),
        shaderVariants: report.shaderVariants,
        errors,
      },
      null,
      2,
    ),
  );
} finally {
  await browser?.close();
  await server.close();
}
