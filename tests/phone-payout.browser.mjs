import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { chromium, expect } from "@playwright/test";
const root = fileURLToPath(new URL("../", import.meta.url));
const server = await createServer({
  configFile: false,
  root,
  logLevel: "error",
  esbuild: { jsx: "automatic" },
  server: { host: "127.0.0.1", port: 0 },
  optimizeDeps: {
    include: ["react", "react-dom/client", "react/jsx-runtime", "lucide-react"],
  },
});
await server.listen();
let browser;
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
  await mkdir(new URL("../artifacts/", import.meta.url), { recursive: true });
  for (const [width, height] of [
    [390, 844],
    [375, 640],
  ]) {
    const page = await browser.newPage({ viewport: { width, height } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.route("**/__payout-test", (r) =>
      r.fulfill({
        contentType: "text/html",
        body: '<html><head><style>html,body,#root{margin:0;width:100%;height:100%;overflow:hidden}</style></head><body><div id="root"></div><script type="module" src="/tests/fixtures/phone-payout.jsx"></script></body></html>',
      }),
    );
    await page.goto(
      `http://127.0.0.1:${server.httpServer.address().port}/__payout-test`,
    );
    const bank = page.locator("[data-bank-value]");
    await expect(bank).toHaveAttribute("data-bank-value", "99500");
    await page.evaluate(() => window.payoutFixture.begin());
    await expect(page.locator("[data-dice-closeup]")).toBeVisible();
    await page.evaluate(() => window.payoutFixture.finish());
    await expect(page.locator("[data-dice-closeup]")).toBeVisible();
    await expect(bank).toHaveAttribute("data-bank-value", "99500");
    assert.equal(
      await page.evaluate(() => window.payoutFixture.state.players[0].bank),
      100500,
      "ledger already credited",
    );
    await expect(
      page.getByRole("tab", { name: "Play", exact: true }),
    ).toHaveAttribute("aria-selected", "true");
    const payout = page.locator(".pg-payout");
    await expect(payout).toHaveAttribute("data-phase", "on-board");
    await expect(payout).toHaveAttribute("data-anchor", "pass");
    await expect(payout).toContainText("+$5 won");
    await expect(payout).toContainText("$5 stake returned");
    await page.screenshot({
      path: `${root}/artifacts/phone-payout-board-${width}.png`,
    });
    await expect(payout).toHaveAttribute("data-phase", "flying");
    await expect(bank).toHaveAttribute("data-bank-value", "99500");
    await page.screenshot({
      path: `${root}/artifacts/phone-payout-flight-${width}.png`,
    });
    await expect(payout).toHaveCount(0);
    await expect(bank).toHaveAttribute("data-bank-value", "100500");
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    // Both line and odds pay; odds stay anchored in their own lane after closing.
    await page.evaluate(() => window.payoutFixture.reset({ kind: "odds" }));
    await page.evaluate(() => window.payoutFixture.begin());
    await page.evaluate(() => window.payoutFixture.finish([2, 2]));
    await expect(payout).toHaveCount(2);
    await expect(
      page.locator('.pg-payout[data-anchor="odds-cue:pass"]'),
    ).toContainText("+$12 won");
    await expect(bank).toHaveAttribute("data-bank-value", "98900");
    await page.screenshot({
      path: `${root}/artifacts/phone-payout-odds-${width}.png`,
    });
    await expect(payout).toHaveCount(0);
    await expect(bank).toHaveAttribute("data-bank-value", "101700");
    // A historical result on first mount cannot move money a second time.
    await page.evaluate(() => window.payoutFixture.reset({ history: true }));
    await page.waitForTimeout(650);
    await expect(payout).toHaveCount(0);
    await expect(bank).toHaveAttribute("data-bank-value", "100500");
    // A place winner keeps its original stake and only delivers its profit.
    await page.evaluate(() => window.payoutFixture.reset({ kind: "place-6" }));
    await page.evaluate(() => window.payoutFixture.begin());
    await page.evaluate(() => window.payoutFixture.finish([3, 3]));
    await expect(payout).toContainText("+$7 won");
    await expect(payout).toContainText("Stake stays on table");
    await expect(payout).toHaveAttribute("data-anchor", "place-6");
    await expect(bank).toHaveAttribute("data-bank-value", "99400");
    await expect(payout).toHaveCount(0);
    await expect(bank).toHaveAttribute("data-bank-value", "100100");
    // Disconnect before the result establishes a fresh baseline on reconnect.
    await page.evaluate(() => window.payoutFixture.reset());
    await page.evaluate(() => window.payoutFixture.begin());
    await page.evaluate(() => window.payoutFixture.connection(false));
    await page.evaluate(() => window.payoutFixture.finish());
    await page.evaluate(() => window.payoutFixture.connection(true));
    await page.waitForTimeout(650);
    await expect(payout).toHaveCount(0);
    await expect(bank).toHaveAttribute("data-bank-value", "100500");
    // Transport reconnecting ahead of its fresh snapshot must not replay it.
    await page.evaluate(() => window.payoutFixture.reset());
    await page.evaluate(() => window.payoutFixture.begin());
    await page.evaluate(() => window.payoutFixture.connection(false));
    await page.evaluate(() => window.payoutFixture.connection(true));
    await page.evaluate(() => window.payoutFixture.finish());
    await page.waitForTimeout(650);
    await expect(payout).toHaveCount(0);
    await expect(bank).toHaveAttribute("data-bank-value", "100500");
    // Reduced motion keeps the explanation but never flies across the screen.
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.evaluate(() => window.payoutFixture.reset());
    await page.evaluate(() => window.payoutFixture.begin());
    await page.evaluate(() => window.payoutFixture.finish());
    await expect(payout).toHaveAttribute("data-phase", "on-board");
    const start = await payout.boundingBox();
    await page.waitForTimeout(300);
    const held = await payout.boundingBox();
    assert.equal(start.x, held.x);
    assert.equal(start.y, held.y);
    await expect(payout).toHaveCount(0);
    assert.deepEqual(errors, []);
    console.log(
      `${width}x${height}: board payout, flight, bank, historical/reconnect, standing stake, reduced motion passed`,
    );
    await page.close();
  }
} finally {
  await browser?.close();
  await server.close();
}
