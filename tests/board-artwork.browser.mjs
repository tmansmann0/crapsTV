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
  if (req.url.startsWith("/board-print-proof")) {
    res.setHeader("content-type", "text/html");
    res.end(
      '<script type="module" src="/scripts/qa/board-artwork-view.js"></script>',
    );
  } else next();
});
let browser;
const errors = [];
const dimension =
  process.env.CI && !process.env.BOARD_FULL_MATRIX
    ? { width: 1280, height: 720 }
    : { width: 3840, height: 2160 };
try {
  await server.listen();
  browser = await chromium.launch({
    headless: true,
    args: [
      `--use-angle=${process.env.BOARD_TEST_ANGLE || (process.platform === "darwin" ? "metal" : "swiftshader")}`,
      "--enable-webgl",
      "--ignore-gpu-blocklist",
    ],
  });
  const results = [];
  for (const aa of process.env.BOARD_FULL_MATRIX ? [1, 0] : [1]) {
    const page = await browser.newPage({ viewport: dimension });
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => {
      if (/GL_INVALID|INVALID_OPERATION|INVALID_VALUE/.test(m.text()))
        errors.push(m.text());
    });
    await page.goto(
      `http://127.0.0.1:${server.httpServer.address().port}/board-print-proof?aa=${aa}&width=${dimension.width}&height=${dimension.height}`,
    );
    await page.waitForFunction(
      () => window.proof?.ready,
      {},
      { timeout: 60000 },
    );
    await mkdir("artifacts", { recursive: true });
    for (const mode of ["classic", "crapless"]) {
      const frames = [];
      for (const [name, scale, native] of [
        ["scaled", 0.5, false],
        ["native-print", 0.5, true],
        ["native-world", 1, true],
      ]) {
        const r = await page.evaluate(
          (args) => window.proof.render(...args),
          [mode, scale, native],
        );
        assert.equal(r.width, dimension.width);
        assert.equal(r.height, dimension.height);
        assert.equal(r.modeledTextureWidth, 1024);
        assert.equal(r.printSource, "native-svg-geometry");
        assert(
          r.solidPixel[2] > 180 && r.solidPixel[1] > 90 && r.solidPixel[0] < 25,
          "solid chip occludes print",
        );
        frames.push(r);
        const { patch, ...small } = r;
        results.push({ mode, name, aa, ...small });
        if (!process.env.CI)
          await page.screenshot({
            path: `artifacts/board-${mode}-${name}-aa${aa}.png`,
          });
      }
      const difference = (a, b) =>
        a.reduce((sum, n, i) => sum + Math.abs(n - b[i]), 0) / a.length;
      assert(
        difference(frames[1].patch, frames[2].patch) < 0.1,
        "native physical felt matches fullnative reference",
      );
      assert(
        difference(frames[0].patch, frames[2].patch) > 0.1,
        "lowworld resolution genuinely softens print without native board pass",
      );
      assert.equal(frames[0].inkHash, frames[1].inkHash);
      assert.equal(
        frames[1].inkHash,
        frames[2].inkHash,
        "actual native ink pixels independent of world resolution",
      );
      assert.deepEqual(
        frames[0].ghostPixel,
        frames[1].ghostPixel,
        "ghost chip remains above the native physical felt",
      );
      const poisoned = await page.evaluate(
        (args) => window.proof.render(...args),
        [mode, 0.35, true, { view: "macro", poisonAtlas: true }],
      );
      const clean = await page.evaluate(
        (args) => window.proof.render(...args),
        [mode, 1, true, { view: "macro", textureLimit: 4096 }],
      );
      assert.equal(
        poisoned.inkHash,
        clean.inkHash,
        "macro ink is real vectors, independent of poisoned atlas, texture cap and render scale",
      );
      assert(
        difference(poisoned.patch, clean.patch) < 0.1,
        "visible macro print stays unchanged when the filtered atlas is replaced with magenta",
      );
      const { patch, ...small } = poisoned;
      results.push({ mode, name: "poisoned-macro", aa, ...small });
      if (!process.env.CI)
        await page.screenshot({
          path: `artifacts/board-${mode}-macro-aa${aa}.png`,
        });
    }
    await page.close();
  }
  assert.deepEqual(errors, []);
  await mkdir("docs/benchmarks", { recursive: true });
  await writeFile(
    "docs/benchmarks/board-artwork.json",
    JSON.stringify({ dimension, results, errors }, null, 2) + "\n",
  );
  console.log(JSON.stringify({ cases: results.length, dimension, errors }));
} finally {
  await browser?.close();
  await server.close();
}
