import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "vite";
import { chromium } from "@playwright/test";
const server = await createServer({
  configFile: false,
  appType: "custom",
  server: { host: "127.0.0.1", port: 0, hmr: false },
  optimizeDeps: { include: ["three"] },
});
server.middlewares.use((req, res, next) => {
  if (req.url === "/board-print-proof") {
    res.setHeader("content-type", "text/html");
    res.end(
      '<script type="module" src="/scripts/qa/board-artwork-view.js"></script>',
    );
  } else next();
});
await server.listen();
const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
const browser = await chromium.launch({
  headless: true,
  args: [
    `--use-angle=${process.env.BOARD_TEST_ANGLE || (process.platform === "darwin" ? "metal" : "swiftshader")}`,
    "--enable-webgl",
    "--ignore-gpu-blocklist",
  ],
});
const errors = [];
try {
  const page = await browser.newPage({
    viewport: { width: 3840, height: 2160 },
  });
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (/GL_INVALID|INVALID_OPERATION|INVALID_VALUE/.test(m.text()))
      errors.push(m.text());
  });
  await page.goto(origin + "/board-print-proof");
  await page.waitForFunction(() => window.proof?.ready, {}, { timeout: 45000 });
  await mkdir("artifacts", { recursive: true });
  const results = [];
  for (const mode of ["classic", "crapless"]) {
    const frames = [];
    for (const [name, scale, print] of [
      ["scaled", 0.75, false],
      ["native-print", 0.75, true],
      ["native-world", 1, true],
    ]) {
      const result = await page.evaluate(
        ([mode, scale, print]) => window.proof.render(mode, scale, print),
        [mode, scale, print],
      );
      assert.equal(result.width, 8192);
      assert.equal(result.height, 4096);
      assert.equal(result.modeledTextureWidth, 1024);
      assert(
        result.solidPixel[2] > 180 &&
          result.solidPixel[1] > 90 &&
          result.solidPixel[0] < 25,
        "solid chip occludes artwork",
      );
      frames.push(result);
      assert.equal(result.plan.uiWidth, 3840);
      assert.equal(result.plan.sceneWidth, scale * 3840);
      const { patch, ...summary } = result;
      results.push({ mode, name, ...summary });
      await page.screenshot({
        path: `artifacts/board-${mode}-${name}.png`,
      });
    }
    const difference = (a, b) =>
      a.reduce((sum, n, i) => sum + Math.abs(n - b[i]), 0) / a.length;
    assert(
      difference(frames[1].patch, frames[2].patch) < 0.1,
      "native-print matches native-world ground pixels",
    );
    assert(
      difference(frames[0].patch, frames[2].patch) > 1,
      "scaled ground loses detail without native print pass",
    );
    assert.deepEqual(
      frames[0].ghostPixel,
      frames[1].ghostPixel,
      "transparent prepared chips remain visible above native print",
    );
  }
  const lifecycle = await page.evaluate(() => window.proof.lifecycle());
  assert.deepEqual(errors, []);
  await writeFile(
    "docs/benchmarks/board-artwork.json",
    JSON.stringify({ results, lifecycle, errors }, null, 2) + "\n",
  );
  console.log(JSON.stringify({ results, lifecycle, errors }));
} finally {
  await browser.close();
  await server.close();
}
