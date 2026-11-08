import { createServer } from "vite";
import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
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
  if (req.url === "/__felt-study") {
    res.setHeader("content-type", "text/html");
    res.end(
      '<script type="module" src="/scripts/qa/felt-study-view.js"></script>',
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
      `--use-angle=${process.env.FELT_STUDY_ANGLE || (process.platform === "darwin" ? "metal" : "swiftshader")}`,
      "--enable-webgl",
      "--ignore-gpu-blocklist",
    ],
  });
  const page = await browser.newPage({
    viewport: { width: 3840, height: 2160 },
  });
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (
      m.type() === "error" ||
      /GL_INVALID|INVALID_OPERATION|INVALID_VALUE/.test(m.text())
    )
      errors.push(m.text());
  });
  await page.goto(
    `http://127.0.0.1:${server.httpServer.address().port}/__felt-study`,
  );
  await page.waitForFunction(
    () => window.feltStudy?.ready,
    {},
    { timeout: 90000 },
  );
  await mkdir("public/studies/felt", { recursive: true });
  const results = [];
  for (const id of ["fine", "plush", "nap"])
    for (const shot of ["hero", "wide"]) {
      const result = await page.evaluate(
        ([id, shot]) => window.feltStudy.render(id, shot),
        [id, shot],
      );
      const url = await page.evaluate(() => window.feltStudy.image());
      const file = `public/studies/felt/${shot}-${id}.jpg`;
      await writeFile(file, Buffer.from(url.split(",")[1], "base64"));
      results.push({ ...result, file });
      console.log(
        `${id}/${shot}: ${result.calls} draws, ${result.triangles} triangles`,
      );
    }
  const report = {
    results,
    errors,
    sources: [
      "https://threejs.org/docs/pages/MeshPhysicalMaterial.html",
      "https://google.github.io/filament/Filament.md.html",
      "https://eheitzresearch.wordpress.com/738-2/",
    ],
    note: "Actual Three.js 4K captures; same table/chips/camera/lighting; selected B has material only, unselected C has bounded macro fibres. No generated or retouched images.",
  };
  await writeFile(
    "public/studies/felt/manifest.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  await writeFile(
    "artifacts/felt-studies.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  if (errors.length) {
    console.error(errors);
    process.exitCode = 1;
  }
} finally {
  await browser?.close();
  await server.close();
}
