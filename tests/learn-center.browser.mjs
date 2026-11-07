import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { chromium, expect } from "@playwright/test";
const root = fileURLToPath(new URL("../", import.meta.url));
const server = await createServer({
  root,
  configFile: false,
  logLevel: "error",
  esbuild: { jsx: "automatic" },
  server: { host: "127.0.0.1", port: 0 },
  optimizeDeps: { include: ["react", "react-dom/client", "react/jsx-runtime"] },
});
await server.listen();
const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
let browser;
const checks = [];
try {
  browser = await chromium.launch({ headless: true });
  await mkdir(new URL("../artifacts/", import.meta.url), { recursive: true });
  for (const [width, height] of [
    [390, 844],
    [375, 640],
  ])
    for (const reducedMotion of ["no-preference", "reduce"]) {
      const page = await browser.newPage({
        viewport: { width, height },
        reducedMotion,
      });
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.route("**/__learn-test", (r) =>
        r.fulfill({
          contentType: "text/html",
          body: '<html><head><style>html,body,#root{margin:0;width:100%;height:100%;overflow:hidden}</style></head><body><div id="root"></div><script type="module" src="/tests/fixtures/learn-center.jsx"></script></body></html>',
        }),
      );
      await page.goto(origin + "/__learn-test");
      const view = page.locator(".learn-center");
      await expect(view).toBeVisible();
      if (reducedMotion === "reduce")
        await expect(view).toHaveAttribute("data-playing", "false");
      else
        await page.getByRole("button", { name: "Pause", exact: true }).click();
      const targets = await view
        .locator("button, select")
        .evaluateAll((nodes) =>
          nodes.map((node) => node.getBoundingClientRect().height),
        );
      assert(
        targets.every((height) => height >= 43.5),
        "lesson controls have 44px targets",
      );
      const bounds = await view.boundingBox();
      assert(
        bounds.y + bounds.height <= height - 60,
        "lesson fits above phone navigation",
      );
      assert(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        "no horizontal overflow",
      );
      const transformBefore = await page
        .locator(".lc-chip")
        .first()
        .getAttribute("style");
      await page
        .getByRole("button", { name: "Next step", exact: true })
        .click();
      await expect(view).toHaveAttribute("data-step", "1");
      await page
        .getByRole("button", { name: "Next step", exact: true })
        .click();
      await expect(view).toHaveAttribute("data-step", "2");
      assert.notEqual(
        await page.locator(".lc-chip").first().getAttribute("style"),
        transformBefore,
        "stake moves to the bank",
      );
      await expect(page.locator(".lc-caption")).toContainText(
        "$5 stake returns with $5 profit",
      );
      const choices = page.getByRole("combobox", { name: "Choose a lesson" });
      for (const mode of ["Classic", "Crapless"]) {
        await page.getByRole("button", { name: mode, exact: true }).click();
        const ids = await choices
          .locator("option")
          .evaluateAll((opts) => opts.map((o) => o.value));
        assert.equal(ids.includes("dont"), mode === "Classic");
        for (const id of ids) {
          await choices.selectOption(id);
          if (
            await page
              .getByRole("button", { name: "Pause", exact: true })
              .count()
          )
            await page
              .getByRole("button", { name: "Pause", exact: true })
              .click();
          while (
            await page
              .getByRole("button", { name: "Next step", exact: true })
              .isEnabled()
          )
            await page
              .getByRole("button", { name: "Next step", exact: true })
              .click();
          assert(
            !/NaN|undefined/.test(await view.innerText()),
            "every lesson has defined amounts",
          );
        }
      }
      await choices.selectOption("odds");
      if (
        await page.getByRole("button", { name: "Pause", exact: true }).count()
      )
        await page.getByRole("button", { name: "Pause", exact: true }).click();
      await page
        .getByRole("button", { name: "Next step", exact: true })
        .click();
      await page.waitForTimeout(900);
      await page.screenshot({
        path: `artifacts/learn-odds-${width}x${height}-${reducedMotion}.png`,
      });
      await choices.selectOption("field");
      await page
        .getByRole("combobox", { name: "Choose an example" })
        .selectOption("twelve");
      await page
        .getByRole("button", { name: "Next step", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Next step", exact: true })
        .click();
      await expect(page.locator(".lc-caption")).toContainText("$15 profit");
      const duration = await page
        .locator(".lc-chip")
        .first()
        .evaluate((el) => getComputedStyle(el).transitionDuration);
      if (reducedMotion === "reduce")
        assert(duration.split(",").every((v) => parseFloat(v) === 0));
      else assert(parseFloat(duration) > 0);
      assert(
        await page.evaluate(
          () =>
            JSON.stringify(window.learnFixture.state) ===
            window.learnFixture.initial,
        ),
        "lessons never mutate live state",
      );
      assert.deepEqual(errors, []);
      checks.push({ width, height, reducedMotion, lessons: 13, passed: true });
      await page.close();
    }
  console.log(JSON.stringify(checks, null, 2));
  await writeFile(
    new URL("../artifacts/learn-checks.json", import.meta.url),
    JSON.stringify(checks, null, 2),
  );
} finally {
  await browser?.close();
  await server.close();
}
