// Authoring QA: actual browser font bounds in editable masters, and portable
// outlined SVG pixels/alpha. This does not connect to or render a game room.
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { chromium } from "@playwright/test";
const root = new URL("../", import.meta.url),
  browser = await chromium.launch({ headless: true });
const results = [];
try {
  const page = await browser.newPage({
    viewport: { width: 2048, height: 1024 },
  });
  for (const mode of ["classic", "crapless"]) {
    const master = await readFile(
      new URL(`assets/source/board-design/text/board-${mode}.svg`, root),
      "utf8",
    );
    await page.setContent(
      `<html><body style="margin:0">${master.replace(/<\?xml[^>]+>/, "")}</body></html>`,
    );
    await page.evaluate(() => document.fonts.ready);
    const issues = await page.evaluate(() => {
      const issues = [],
        canvas = document.createElement("canvas"),
        ctx = canvas.getContext("2d");
      for (const element of document.querySelectorAll("text")) {
        if (element.dataset.shade) continue;
        const style = getComputedStyle(element);
        ctx.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
        const metrics = ctx.measureText(element.textContent),
          local = element.getBBox();
        const baseline = element.y.baseVal.getItem(0).value,
          matrix = element.getScreenCTM();
        const points = [
          [local.x, baseline - metrics.actualBoundingBoxAscent],
          [local.x + local.width, baseline - metrics.actualBoundingBoxAscent],
          [local.x, baseline + metrics.actualBoundingBoxDescent],
          [local.x + local.width, baseline + metrics.actualBoundingBoxDescent],
        ].map(([x, y]) => new DOMPoint(x, y).matrixTransform(matrix));
        const bounds = [
          Math.min(...points.map((p) => p.x)),
          Math.min(...points.map((p) => p.y)),
          Math.max(...points.map((p) => p.x)),
          Math.max(...points.map((p) => p.y)),
        ];
        const host = element.closest("[data-rect]");
        if (host) {
          const rect = host.dataset.rect.split(/\s+/).map(Number);
          if (
            bounds[0] < rect[0] - 1 ||
            bounds[1] < rect[1] - 1 ||
            bounds[2] > rect[2] + 1 ||
            bounds[3] > rect[3] + 1
          )
            issues.push({ text: element.textContent, bounds, rect });
        }
      }
      return issues;
    });
    assert.deepEqual(
      issues,
      [],
      `${mode}: printed lettering fits its semantic region`,
    );
    const svg = await readFile(
      new URL(`public/assets/board-${mode}.svg`, root),
      "utf8",
    );
    const pixels = await page.evaluate(async (source) => {
      const image = new Image();
      image.src = `data:image/svg+xml;base64,${source}`;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = 2048;
      canvas.height = 1024;
      const context = canvas.getContext("2d");
      context.drawImage(image, 0, 0);
      const pixel = (x, y) => [...context.getImageData(x, y, 1, 1).data];
      return {
        corner: pixel(0, 0),
        apron: pixel(1024, 940),
        apron2: pixel(500, 900),
      };
    }, Buffer.from(svg).toString("base64"));
    assert.equal(
      pixels.corner[3],
      0,
      "rounded felt corners retain transparency",
    );
    assert.deepEqual(pixels.apron, [10, 58, 45, 255]);
    assert.deepEqual(
      pixels.apron2,
      pixels.apron,
      "odds apron stays flat and free of decorative printing",
    );
    results.push({ mode, issues, pixels });
  }
  await mkdir(new URL("artifacts/", root), { recursive: true });
  await writeFile(
    new URL("artifacts/board-design-qa.json", root),
    JSON.stringify(results, null, 2),
  );
  console.log(
    "Classic + crapless browser font bounds, outlined SVG alpha and clean apron passed.",
  );
} finally {
  await browser.close();
}
