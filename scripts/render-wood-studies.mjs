import { createServer } from "vite";
import { chromium } from "@playwright/test";
import { mkdir, writeFile, readFile, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
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
  if (req.url === "/__material-looks") {
    res.setHeader("content-type", "text/html");
    res.end(
      '<script type="module" src="/scripts/qa/material-look-view.js"></script>',
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
    if (
      m.type() === "error" ||
      /INVALID_OPERATION|INVALID_VALUE|GL_INVALID/.test(m.text())
    )
      errors.push(m.text());
  });
  await page.goto(
    `http://127.0.0.1:${server.httpServer.address().port}/__material-looks`,
  );
  await page.waitForFunction(
    () => window.materialLookPreview?.ready,
    {},
    { timeout: 90000 },
  );
  await mkdir("public/studies/materials", { recursive: true });
  await mkdir("artifacts", { recursive: true });
  const results = [];
  for (const id of ["american", "smoked", "natural"]) {
    await page.evaluate((id) => window.materialLookPreview.setWoodLook(id), id);
    for (const shot of ["hero", "wide"]) {
      const result = await page.evaluate(
        (shot) => window.materialLookPreview.render("mixed", shot),
        shot,
      );
      const url = await page.evaluate(() => window.materialLookPreview.image());
      const file = `artifacts/wood-study-${id}-${shot}.jpg`;
      await writeFile(file, Buffer.from(url.split(",")[1], "base64"));
      results.push({ ...result, file, bytes: (await stat(file)).size });
      console.log(
        `${id}/${shot}: ${result.width}×${result.height}, wood=${result.woodLook?.id}`,
      );
    }
  }
  const model = await readFile(
    "public/assets/table-player-rails-optimized.glb",
  );
  const report = {
    results,
    errors,
    modelSha256: createHash("sha256").update(model).digest("hex"),
    note: "Actual native-4K WebGL material variants; fixed camera, geometry, lighting, textures and scene. No image-generation/postprocessing; JPEG encoding only.",
  };
  await writeFile(
    "artifacts/wood-studies.json",
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
