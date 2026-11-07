import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { chromium } from "@playwright/test";
import { textAngleArcminutes } from "../scripts/tv-readability.mjs";
const root = fileURLToPath(new URL("../", import.meta.url));
const server = await createServer({
  configFile: false,
  root,
  logLevel: "error",
  server: { host: "127.0.0.1", port: 0 },
  optimizeDeps: { include: ["three", "qrcode", "cannon-es"] },
});
await server.listen();
let browser;
const results = [];
try {
  browser = await chromium.launch({
    headless: true,
    args: [
      process.platform === "darwin" && !process.env.CI
        ? "--use-angle=metal"
        : "--use-angle=swiftshader",
      "--enable-webgl",
      "--ignore-gpu-blocklist",
    ],
  });
  await mkdir(`${root}/artifacts`, { recursive: true });
  for (const mode of ["compact", "large"])
    for (const [width, height] of [
      [1920, 1080],
      [3840, 2160],
    ]) {
      const page = await browser.newPage({
        viewport: { width, height },
        deviceScaleFactor: 1,
      });
      await page.addInitScript((mode) => {
        localStorage.removeItem("crapstv-tv-labels-v1");
        if (mode === "compact")
          localStorage.removeItem("crapstv-tv-ui-size-v1");
        else localStorage.setItem("crapstv-tv-ui-size-v1", mode);
      }, mode);
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.route("**/__tv-readability", (r) =>
        r.fulfill({
          contentType: "text/html",
          body: '<html><body style="margin:0;overflow:hidden"><script type="module" src="/tests/fixtures/tv-readability.js"></script></body></html>',
        }),
      );
      await page.goto(
        `http://127.0.0.1:${server.httpServer.address().port}/__tv-readability`,
      );
      await page.waitForFunction(() => window.tvReady);
      await page.waitForTimeout(150);
      for (const scenario of ["gameplay", "settings", "graphics", "intro"]) {
        const r = await page.evaluate(
          (s) => window.tvReadability.snapshot(s),
          scenario,
        );
        assert.deepEqual(r.framebuffer, [width, height]);
        assert.equal(
          r.layout.uiSize,
          mode,
          "missing preference defaults to Compact; saved Large is respected",
        );
        for (const [panel, info] of Object.entries(r.text)) {
          if (!info.visible) continue;
          assert(
            info.x >= 0 &&
              info.y >= 0 &&
              info.x + info.width <= width + 0.1 &&
              info.y + info.height <= height + 0.1,
            `${panel} fits`,
          );
          for (const line of info.lines) {
            if (Number.isFinite(line.left)) {
              assert(
                line.x - line.left >= -1 &&
                  line.x + line.right <= info.logicalWidth + 1,
                `${panel}: text fits horizontally: ${line.text}`,
              );
              assert(
                line.y - line.ascent >= -1 &&
                  line.y + line.descent <= info.logicalHeight + 1,
                `${panel}: text fits vertically: ${line.text}`,
              );
            }
            line.arcminutesAt8ft = textAngleArcminutes(
              line.cssGlyphHeight,
              height,
              8,
            );
            line.arcminutesAt14ft = textAngleArcminutes(
              line.cssGlyphHeight,
              height,
              14,
            );
          }
        }
        const important = Object.entries(r.text)
          .filter(
            ([name, p]) =>
              p.visible &&
              ["join", "status", "settings", "graphics"].includes(name),
          )
          .flatMap(([panel, p]) =>
            p.lines
              .filter(
                (l) =>
                  l.importance !== "secondary" && /[\p{L}\p{N}]/u.test(l.text),
              )
              .map((l) => ({ panel, ...l })),
          );
        const small = important.filter(
          (l) =>
            l.cssGlyphHeight < (26 * height) / 1080 - (0.01 * height) / 1080,
        );
        results.push({
          mode,
          width,
          height,
          scenario,
          ...r,
          smallImportantText: small,
        });
        await page.screenshot({
          path: `${root}/artifacts/tv-ui-${mode}-${width}-${scenario}.png`,
        });
      }
      const settings = await page.evaluate(() =>
        window.tvReadability.snapshot("settings"),
      );
      const target = settings.actions["ui-size"];
      assert(target, "settings expose the UI size choice");
      const changed = await page.evaluate(
        ({ x, y }) => window.tvReadability.activateAt(x, y),
        target,
      );
      const other = mode === "compact" ? "large" : "compact";
      assert.equal(
        changed.action,
        "ui-size",
        "size control raycasts at its actual rendered position",
      );
      assert.equal(changed.mode, other);
      assert.equal(changed.stored, other);
      assert.equal(
        await page.evaluate(() => window.tvReadability.recreate()),
        other,
        "size choice survives UI recreation",
      );
      assert.equal(
        (await page.evaluate(() => window.tvReadability.labels())).mode,
        "smooth",
      );
      for (const expected of ["stable", "hidden", "smooth"]) {
        const view = await page.evaluate(() =>
          window.tvReadability.snapshot("settings"),
        );
        const point = view.actions.labels;
        assert(point, "settings expose Labels");
        const picked = await page.evaluate(
          ({ x, y }) => window.tvReadability.activateAt(x, y),
          point,
        );
        assert.equal(
          picked.action,
          "labels",
          "Labels raycasts at its visible row",
        );
        assert.deepEqual(
          await page.evaluate(() => window.tvReadability.labels()),
          { mode: expected, stored: expected },
        );
        await page.evaluate(() => window.tvReadability.recreate());
        assert.equal(
          (await page.evaluate(() => window.tvReadability.labels())).mode,
          expected,
          "Labels preference survives recreation",
        );
      }
      assert.deepEqual(errors, []);
      await page.close();
    }
  await writeFile(
    `${root}/artifacts/tv-readability.json`,
    JSON.stringify(results, null, 2),
  );
  console.log(
    JSON.stringify(
      results.map((r) => ({
        mode: r.mode,
        width: r.width,
        scenario: r.scenario,
        belowLargeGuideline: r.smallImportantText.length,
        violations:
          r.mode === "large"
            ? r.smallImportantText.map((l) => ({
                text: l.text,
                pixels: l.cssGlyphHeight,
                arcmin14: l.arcminutesAt14ft,
              }))
            : [],
      })),
      null,
      2,
    ),
  );
  const tooSmall = results
    .filter((result) => result.mode === "large")
    .flatMap((result) =>
      result.smallImportantText.map(
        (line) =>
          `${result.width} ${result.scenario}: ${line.text} (${line.cssGlyphHeight.toFixed(2)}px)`,
      ),
    );
  assert.deepEqual(tooSmall, [], "Large mode minimum rendered text height");
  for (const compact of results.filter((result) => result.mode === "compact")) {
    const large = results.find(
      (result) =>
        result.mode === "large" &&
        result.width === compact.width &&
        result.scenario === compact.scenario,
    );
    for (const panel of Object.keys(compact.layout.panels)) {
      const a = compact.layout.panels[panel],
        b = large.layout.panels[panel];
      assert(
        Math.abs(a.width / b.width - 0.67) < 0.005,
        `${panel}: Compact width is67%ofLarge`,
      );
      assert(
        Math.abs(a.height / b.height - 0.67) < 0.005,
        `${panel}: Compact height is67%ofLarge`,
      );
    }
  }
  for (const mode of ["compact", "large"])
    for (const hd of results.filter(
      (result) => result.mode === mode && result.width === 1920,
    )) {
      const uhd = results.find(
        (result) =>
          result.mode === mode &&
          result.width === 3840 &&
          result.scenario === hd.scenario,
      );
      for (const panel of Object.keys(hd.layout.panels)) {
        assert(
          Math.abs(
            uhd.layout.panels[panel].width - hd.layout.panels[panel].width * 2,
          ) < 0.01,
          `${mode} ${panel}:4Kwidthdoubles`,
        );
        assert(
          Math.abs(
            uhd.layout.panels[panel].height -
              hd.layout.panels[panel].height * 2,
          ) < 0.01,
          `${mode} ${panel}:4Kheightdoubles`,
        );
      }
    }
} finally {
  await browser?.close();
  await server.close();
}
