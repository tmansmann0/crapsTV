import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { chromium } from "@playwright/test";

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
  for (const mode of ["compact", "large"]) {
    for (const [width, height] of [
      [1280, 720],
      [1600, 900],
      [1920, 1080],
      [3840, 2160],
    ]) {
      const page = await browser.newPage({
        viewport: { width, height },
        deviceScaleFactor: 1,
      });
      await page.addInitScript(
        (mode) => localStorage.setItem("crapstv-tv-ui-size-v1", mode),
        mode,
      );
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.route("**/__join-card", (route) =>
        route.fulfill({
          contentType: "text/html",
          body: '<html><body style="margin:0;overflow:hidden"><script type="module" src="/tests/fixtures/tv-readability.js"></script></body></html>',
        }),
      );
      await page.goto(
        `http://127.0.0.1:${server.httpServer.address().port}/__join-card`,
      );
      await page.waitForFunction(() => window.tvReady);
      for (const [name, url] of Object.entries({
        local: "http://crapstv-play.local:3005/join?code=RNHK35",
        numeric: "http://192.168.100.250:65535/?room=RNHK35",
        github: "https://tylermansmann.github.io/crapsTV/join?code=RNHK35",
        public:
          "https://games.example.com/a-long-public-base/crapsTV/?room=RNHK35#join",
      })) {
        await page.evaluate((url) => {
          window.tvReadability.setJoinURL(url);
          window.tvReadability.snapshot("gameplay");
        }, url);
        await page.waitForTimeout(40);
        const snapshot = await page.evaluate(() =>
          window.tvReadability.snapshot("gameplay"),
        );
        const card = snapshot.text.join;
        assert.deepEqual(snapshot.framebuffer, [width, height]);
        assert.equal(snapshot.layout.uiSize, mode);
        assert.equal(card.address.lines.join(""), card.address.address);
        const expectedURL = new URL(url);
        assert.equal(
          card.address.address,
          `${expectedURL.host}${expectedURL.pathname === "/" ? "" : expectedURL.pathname}`,
        );
        assert(card.address.lines.length <= 2);
        assert(
          card.address.size >= (name === "public" ? 22 : 30),
          `${name} ${mode} ${width}: normal local/public URLs retain a readable font (${card.address.size}px)`,
        );
        assert(!card.address.address.includes("…"));
        for (const line of card.lines) {
          assert(
            line.x - line.left >= -1 &&
              line.x + line.right <= card.logicalWidth + 1,
            `horizontal fit: ${line.text}`,
          );
          assert(
            line.y - line.ascent >= -1 &&
              line.y + line.descent <= card.logicalHeight + 1,
            `vertical fit: ${line.text}`,
          );
          const overlapsQR =
            line.x + line.right > card.qr.x &&
            line.x - line.left < card.qr.x + card.qr.size &&
            line.y + line.descent > card.qr.y &&
            line.y - line.ascent < card.qr.y + card.qr.size;
          assert(!overlapsQR, `QR collision: ${line.text}`);
        }
        const path = `${root}/artifacts/join-card-${mode}-${width}-${name}.png`;
        if (name === "local" || name === "public") {
          await page.screenshot({
            path,
            clip: {
              x: card.x,
              y: card.y,
              width: card.width,
              height: card.height,
            },
          });
        }
        results.push({
          mode,
          width,
          height,
          name,
          url,
          card,
          framebuffer: snapshot.framebuffer,
        });
      }
      assert.deepEqual(errors, []);
      await page.close();
    }
  }
  await writeFile(
    `${root}/artifacts/join-card-qa.json`,
    JSON.stringify(results, null, 2),
  );
  console.log(
    `${results.length} join-card cases passed: host/port/path only, bounds, QR separation, native 720p/900p/1080p/4K.`,
  );
} finally {
  await browser?.close();
  await server.close();
}
