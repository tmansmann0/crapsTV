import { createServer } from "vite";
import { chromium } from "@playwright/test";
import { writeFile } from "node:fs/promises";
const phase = process.argv[2] || "before";
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
  if (req.url === "/__corners") {
    res.setHeader("content-type", "text/html");
    res.end(
      '<script type="module" src="/scripts/qa/corner-shading-view.js"></script>',
    );
  } else next();
});
let browser;
const errors = [];
try {
  await server.listen();
  browser = await chromium.launch({
    headless: true,
    args: ["--use-angle=metal", "--enable-webgl", "--ignore-gpu-blocklist"],
  });
  const page = await browser.newPage({
    viewport: { width: 1600, height: 1000 },
  });
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await page.goto(
    `http://127.0.0.1:${server.httpServer.address().port}/__corners`,
  );
  await page.waitForFunction(() => window.ready, {}, { timeout: 60000 });
  const report = { errors, views: {} };
  for (const view of [
    "frontRight",
    "frontLeft",
    "backRight",
    "backLeft",
    "grazing",
    "shelf",
  ])
    for (const mode of ["pbr", "no-normal", "unlit"]) {
      report.views[`${view}-${mode}`] = await page.evaluate(
        ({ view, mode }) => window.capture(view, mode),
        { view, mode },
      );
      await page.screenshot({
        path: `artifacts/corner-${phase}-${view}-${mode}.png`,
      });
    }
  await writeFile(
    `artifacts/corner-${phase}-metrics.json`,
    JSON.stringify(report, null, 2),
  );
  console.log(report);
  if (errors.length) process.exitCode = 1;
} finally {
  await browser?.close();
  await server.close();
}
