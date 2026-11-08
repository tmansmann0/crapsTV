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
  if (req.url === "/__material-depth") {
    res.setHeader("content-type", "text/html");
    res.end(
      '<script type="module" src="/scripts/qa/material-depth-view.js"></script>',
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
    `http://127.0.0.1:${server.httpServer.address().port}/__material-depth`,
  );
  await page.waitForFunction(() => window.ready, {}, { timeout: 60000 });
  const report = { errors, views: {} };
  for (const view of [
    "wood-close",
    "wood-raking",
    "rail-close",
    "rail-raking",
  ]) {
    report.views[view] = await page.evaluate((v) => window.capture(v), view);
    await page.screenshot({
      path: `artifacts/material-depth-${phase}-${view}.png`,
    });
  }
  await writeFile(
    `artifacts/material-depth-${phase}-metrics.json`,
    JSON.stringify(report, null, 2),
  );
  console.log(report);
  if (errors.length) process.exitCode = 1;
} finally {
  await browser?.close();
  await server.close();
}
