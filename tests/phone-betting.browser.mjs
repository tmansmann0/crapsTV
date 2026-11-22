// Isolated component + authoritative rules: never connects to a live room.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
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
const reports = [];
try {
  browser = await chromium.launch({ headless: true });
  await mkdir(`${root}/artifacts`, { recursive: true });
  for (const width of [375, 320]) {
    const page = await browser.newPage({ viewport: { width, height: 640 } });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/__betting-test", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: '<html><head><style>html,body,#root{margin:0;width:100%;height:100%;overflow:hidden}</style></head><body><div id="root"></div><script type="module" src="/tests/fixtures/phone-betting.jsx"></script></body></html>',
      }),
    );
    await page.goto(
      `http://127.0.0.1:${server.httpServer.address().port}/__betting-test`,
    );
    const table = () =>
      page.getByRole("button", { name: "Table", exact: true }).click();
    const more = () => page.getByRole("button", { name: /^More bets/ }).click();
    const mode = page.getByLabel("Number wager type");
    const tile = (id) => page.locator(`[data-bet-id="${id}"]`);
    const bank = () =>
      page.evaluate(() => window.bettingFixture.state.players[0].bank);
    const initialBank = await bank();
    const initialFelt = await page.locator(".pg-felt").boundingBox();
    await page.evaluate(() => window.bettingFixture.teach(true));
    await mode.selectOption("buy");
    await expect(tile("buy-4")).toBeVisible();
    await expect(tile("buy-10")).toBeVisible();
    await tile("buy-4").click();
    await expect(page.locator(".pg-feedback")).toContainText(
      "less 5% of stake on wins",
    );
    await page
      .getByRole("button", { name: "Bet $5 on Buy 4", exact: true })
      .click();
    await expect(tile("buy-4")).toHaveAccessibleName(/your stake \$5/);
    assert.equal(await bank(), initialBank - 500);
    await mode.selectOption("lay");
    await tile("lay-4").click();
    await expect(page.locator(".pg-feedback")).toContainText(
      "Take down the opposing bet",
    );
    await page
      .getByRole("button", { name: "Add $5 chip", exact: true })
      .click();
    await page.getByRole("button", { name: /^Place \$5/ }).click();
    await expect(page.getByRole("alert")).toContainText(
      "Take down the opposing bet",
    );
    assert.equal(
      await page.evaluate(
        () => window.bettingFixture.state.players[0].bets.length,
      ),
      1,
    );
    await mode.selectOption("buy");
    await page.evaluate(() => window.bettingFixture.bank(0));
    await tile("buy-4").click();
    await page
      .getByRole("button", { name: "Take down Buy 4, refund $5", exact: true })
      .click();
    assert.equal(
      await bank(),
      500,
      "zero-bank player receives the exact take-down refund",
    );
    await mode.selectOption("lay");
    await tile("lay-4").click();
    await expect(page.locator(".pg-feedback")).toContainText("1:2");
    await expect(page.locator(".pg-feedback")).toContainText(
      "less 5% of winnings",
    );
    await page
      .getByRole("button", { name: "Bet $6 on Lay 4", exact: true })
      .count()
      .then((count) =>
        assert.equal(count, 0, "bank cannot fund the legal $6 lay minimum"),
      );
    await page.evaluate(() => window.bettingFixture.bank(10000));
    await tile("lay-4").click(); // deselect
    await tile("lay-4").click();
    await page
      .getByRole("button", { name: "Bet $6 on Lay 4", exact: true })
      .click();
    assert.equal(await bank(), 9400);
    await tile("lay-4").click();
    await page
      .getByRole("button", { name: "Take down Lay 4, refund $6", exact: true })
      .click();
    assert.equal(await bank(), 10000);
    const currentFelt = await page.locator(".pg-felt").boundingBox();
    assert.equal(
      currentFelt.y,
      initialFelt.y,
      "selection, feedback, modes, and removal keep the felt stationary",
    );
    assert.equal(currentFelt.height, initialFelt.height);

    // Capped odds remain selectable, independently of the locked Pass contract.
    await page.evaluate(() =>
      window.bettingFixture.reset({ hasLine: true, point: 4 }),
    );
    await page.evaluate(() => window.bettingFixture.placeOdds(2400));
    const odds = page.locator(".pg-tile-odds");
    await expect(odds).toBeEnabled();
    await expect(odds).toContainText("At odds limit");
    await odds.click();
    await page
      .getByRole("button", { name: /Take down Take odds.*refund \$24/ })
      .click();
    await tile("pass").click();
    await expect(page.locator(".pg-wager-actions")).toContainText(
      "Locked until its point resolves",
    );
    await expect(
      page.getByRole("button", { name: /Pass line locked/ }),
    ).toBeDisabled();

    await page.evaluate(() => {
      window.bettingFixture.reset({ hasLine: true });
      window.bettingFixture.place("buy-4", 500);
    });
    await tile("pass").click();
    await expect(page.locator(".pg-wager-actions")).toContainText(
      "Take down your Buy bets first",
    );
    await expect(
      page.getByRole("button", { name: /Pass line locked/ }),
    ).toBeDisabled();
    await page.getByRole("tab", { name: /^Bets/ }).click();
    await expect(
      page.getByRole("button", { name: "Pass line is locked", exact: true }),
    ).toBeDisabled();
    await page
      .getByRole("button", { name: "Take down Buy 4, refund $5", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Take down Pass line, refund $5", exact: true })
      .click();
    assert.equal(await bank(), initialBank);

    // All 21 unique pairs are reachable through actual die-face controls.
    await page.evaluate(() => window.bettingFixture.reset());
    await more();
    await page.getByRole("button", { name: "Hop pairs", exact: true }).click();
    let pairs = 0;
    for (let a = 1; a <= 6; a++)
      for (let b = a; b <= 6; b++) {
        await page
          .getByRole("button", { name: `First die ${a}`, exact: true })
          .click();
        await page
          .getByRole("button", { name: `Second die ${b}`, exact: true })
          .click();
        await expect(tile(`hop-${a}-${b}`)).toBeVisible();
        pairs++;
      }
    assert.equal(pairs, 21);
    await page
      .getByRole("button", { name: "First die 2", exact: true })
      .click();
    await tile("hop-2-6").click();
    await page
      .getByRole("button", { name: "Bet $5 on Hop 2 + 6", exact: true })
      .click();
    await expect(tile("hop-2-6")).toHaveAccessibleName(/your stake \$5/);
    await expect(page.locator(".pg-notice")).toContainText("Placed $5");
    await tile("hop-2-6").click();
    await page.screenshot({
      path: `${root}/artifacts/phone-betting-hop-${width}.png`,
    });

    // ATS is a contract with persistent hit progress and a post-roll lock.
    await page.evaluate(() => window.bettingFixture.reset());
    await more();
    for (const id of ["bonus-small", "bonus-tall", "bonus-all"]) {
      await tile(id).click();
      const name = await page.evaluate(
        (id) =>
          id === "bonus-small"
            ? "All Small"
            : id === "bonus-tall"
              ? "All Tall"
              : "Make ’em All",
        id,
      );
      await page
        .getByRole("button", { name: `Bet $5 on ${name}`, exact: true })
        .click();
    }
    await page.evaluate(() => window.bettingFixture.roll([2, 2]));
    await expect(tile("bonus-small").locator(".is-hit")).toHaveText(["4"]);
    await tile("bonus-small").click();
    await expect(page.locator(".pg-wager-actions")).toContainText(
      "Locked until bonus resolves",
    );
    await expect(
      page.getByRole("button", { name: /All Small locked/ }),
    ).toBeDisabled();
    await page.screenshot({
      path: `${root}/artifacts/phone-betting-bonus-${width}.png`,
    });

    // Distinct travelled Don't Come wagers remove only the chosen stored ID and attached odds.
    await page.evaluate(() => {
      const f = window.bettingFixture;
      f.reset({ point: 4 });
      f.place("dontcome", 500);
      f.roll([2, 3]);
      f.place("dontcome", 500);
      f.roll([3, 3]);
      const first = f.state.players[0].bets.find((b) => b.type === "dontcome");
      f.place(`odds:${first.id}`, 600);
      f.bank(0);
    });
    await tile("dontcome").click();
    await expect(page.getByLabel("Choose existing wager")).toHaveCount(1);
    const contractIds = await page.evaluate(() =>
      window.bettingFixture.state.players[0].bets
        .filter((b) => b.type === "dontcome")
        .map((b) => b.id),
    );
    await page.getByLabel("Choose existing wager").selectOption(contractIds[0]);
    await page
      .getByRole("button", { name: /Take down Don’t come at 5, refund \$11/ })
      .click();
    assert.equal(await bank(), 1100);
    const remainingIds = await page.evaluate(() =>
      window.bettingFixture.state.players[0].bets.map((b) => b.id),
    );
    assert.deepEqual(remainingIds, [contractIds[1]]);
    await page.evaluate(() =>
      window.bettingFixture.reset({ mode: "crapless" }),
    );
    await expect(mode.locator('option[value="lay"]')).toBeDisabled();
    await expect(mode.locator('option[value="lay"]')).toHaveText(
      "Lay: classic only",
    );
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      "no horizontal overflow",
    );
    assert.deepEqual(errors, []);
    reports.push({
      width,
      height: 640,
      passed: [
        "buy / lay legal minimum and commission",
        "opposition rejection",
        "zero-bank take-down refund",
        "locked Pass contract",
        "capped odds take-down",
        "Pass Line stays up with an active Buy bet",
        "all 21 hop pairs",
        "ATS placement, progress, and contract lock",
        "specific travelled wager + child odds refund",
        "crapless Lay explanation",
        "stationary felt",
        "no horizontal overflow",
        "no browser errors",
      ],
    });
    await page.close();
  }
  await writeFile(
    `${root}/artifacts/phone-betting-qa.json`,
    JSON.stringify(reports, null, 2),
  );
  console.log(JSON.stringify(reports));
} finally {
  await browser?.close();
  await server.close();
}
