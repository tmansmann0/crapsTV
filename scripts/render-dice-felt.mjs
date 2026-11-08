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
  if (req.url.startsWith("/__dice-felt")) {
    res.setHeader("content-type", "text/html");
    res.end(
      '<script type="module" src="/scripts/qa/dice-felt-view.js"></script>',
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
    `http://127.0.0.1:${server.httpServer.address().port}/__dice-felt${phase === "after" ? "?after" : ""}`,
  );
  await page.waitForFunction(() => window.ready, {}, { timeout: 60000 });
  const report = { errors, views: {} };
  for (const view of [
    "dice-close",
    "dice-raking",
    "felt-close",
    "felt-raking",
    ...(phase === "after" ? ["translucent-close"] : []),
  ]) {
    report.views[view] = await page.evaluate((v) => window.capture(v), view);
    await page.screenshot({ path: `artifacts/dice-felt-${phase}-${view}.png` });
  }
  await writeFile(
    `artifacts/dice-felt-${phase}-metrics.json`,
    JSON.stringify(report, null, 2),
  );
  console.log(report);
  if (errors.length) process.exitCode = 1;
} finally {
  await browser?.close();
  await server.close();
}
