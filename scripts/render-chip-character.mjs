import { createServer } from "vite";
import { chromium } from "@playwright/test";
import { writeFile, mkdir } from "node:fs/promises";
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
  if (req.url === "/__chip-character") {
    res.setHeader("content-type", "text/html");
    res.end(
      '<base href="/"><script type="module" src="/scripts/qa/chip-character-view.js"></script>',
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
    viewport: { width: 1600, height: 1000 },
  });
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await page.goto(
    `http://127.0.0.1:${server.httpServer.address().port}/__chip-character`,
  );
  await page.waitForFunction(() => window.ready, {}, { timeout: 60000 });
  const report = { errors, views: {} };
  await mkdir("artifacts", { recursive: true });
  for (const view of ["clean", "raking", "top", "macro"]) {
    report.views[view] = await page.evaluate((v) => window.capture(v), view);
    await page.screenshot({ path: `artifacts/chip-character-${view}.png` });
  }
  await writeFile(
    "artifacts/chip-character-qa.json",
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report));
  if (errors.length) process.exitCode = 1;
} finally {
  await browser?.close();
  await server.close();
}
