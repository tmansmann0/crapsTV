import { mkdir } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { finishRoll } from "../../src/game.js";
import { RoomHub } from "../../src/hub.js";

test("two phones verify top-ups and complete a required drink assignment", async ({
  browser,
  baseURL,
}) => {
  const hub = new RoomHub("DRINKS");
  const contexts = await Promise.all([
    browser.newContext({ baseURL, viewport: { width: 375, height: 640 } }),
    browser.newContext({ baseURL, viewport: { width: 320, height: 640 } }),
  ]);
  const errors = [];

  async function join(context, name) {
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/api/config", (route) =>
      route.fulfill({ json: { local: true, code: "DRINKS" } }),
    );
    await page.routeWebSocket("**/socket", (socket) => {
      hub.connect(name, (message) => socket.send(JSON.stringify(message)));
      socket.onMessage((message) => hub.receive(name, JSON.parse(message)));
      socket.onClose(() => hub.disconnect(name));
    });
    await page.goto("/join?code=DRINKS");
    await page.getByLabel("Your name").fill(name);
    await page.getByRole("button", { name: "Join", exact: true }).click();
    return page;
  }

  try {
    const host = await join(contexts[0], "Alice");
    const mode = host.getByRole("button", { name: /Drinking Mode/ });
    await expect(mode).toHaveAttribute("aria-pressed", "false");
    await mode.click();
    await expect(host.getByLabel("Sip value ($)")).toHaveValue("5");
    await expect(host.getByLabel("Shot value ($)")).toHaveValue("25");
    await expect(host.getByLabel(/Enable.*Finish drink/)).not.toBeChecked();
    await expect(host.getByLabel("Finish drink value ($)")).toHaveCount(0);
    await host.getByLabel("Sip value ($)").fill("6");
    await host.getByLabel("Shot value ($)").fill("20");
    await host.getByLabel("Drink assignment markup (%)").fill("25");
    await host.getByLabel(/Enable.*Finish drink/).check();
    await host.getByLabel("Finish drink value ($)").fill("30");
    await host.getByLabel("Betting window (seconds)").fill("0");
    const guest = await join(contexts[1], "Jordan");
    await host.getByRole("button", { name: "Open the table" }).click();
    await host.getByRole("button", { name: "Add chips in Drinks" }).click();

    const [alice, jordan] = hub.state.players;
    expect([alice.bank, jordan.bank]).toEqual([0, 0]);
    const add = host
      .locator(".pg-drink-card")
      .filter({ has: host.getByRole("heading", { name: "Add chips" }) });
    const offer = host
      .locator(".pg-drink-card")
      .filter({ has: host.getByRole("heading", { name: "Send a drink" }) });
    await expect(add.locator("option[value=sip]")).toHaveText("Sip · $6");
    await expect(offer.locator("option[value=shot]")).toHaveText("Shot · $25");
    await expect(
      offer.getByRole("button", { name: /Send a drink/ }),
    ).toBeDisabled();
    await add.getByLabel("Drink", { exact: true }).selectOption("finish");
    await expect(add.getByLabel("Quantity")).toHaveCount(0);
    await add.getByRole("button", { name: /Request verification/ }).click();
    await expect(add.getByText(/Waiting for verification/)).toBeVisible();
    expect(alice.bank).toBe(0);
    await guest.getByRole("tab", { name: /Drinks/ }).click();
    await expect(
      guest.locator('[aria-label="Incoming requests"] svg.drink-icon'),
    ).toBeVisible();
    await guest.getByRole("button", { name: "Verify top-up" }).click();
    await expect(host.locator("[data-bank-value]")).toHaveAttribute(
      "data-bank-value",
      "3000",
    );

    // Settle a known Field win through the regular game rules.
    hub.receive("Alice", { type: "bet", betId: "field", amount: 2500 });
    hub.state.rolling = true;
    finishRoll(hub.state, [1, 1]);
    hub.broadcast();
    await expect(host.locator("[data-bank-value]")).toHaveAttribute(
      "data-bank-value",
      "8000",
    );
    await host.getByRole("tab", { name: "Drinks", exact: true }).click();
    await guest.getByRole("tab", { name: "Drinks", exact: true }).click();
    const sendDrink = offer.getByRole("button", { name: /Send a drink/ });
    await offer.getByLabel("Drink", { exact: true }).selectOption("finish");
    await expect(sendDrink).toHaveText(/\$37\.50/);
    await sendDrink.click();
    await expect(offer.getByText(/awaiting completion/)).toBeVisible();
    await expect(guest.getByText(/Required drink/)).toBeVisible();
    await expect(
      guest.getByRole("button", { name: /Accept|Decline/ }),
    ).toHaveCount(0);
    await expect(offer.getByRole("button", { name: /Cancel/ })).toHaveCount(0);
    await expect(host.locator(".pg-drink-hero")).toContainText("$12.50");
    expect([alice.bank, alice.buyIn, jordan.bank]).toEqual([4250, 3000, 0]);
    await guest.getByRole("button", { name: "Mark drink complete" }).click();
    await expect(offer.getByText(/awaiting completion/)).toHaveCount(0);
    expect(alice.bank).toBe(4250);
    expect(hub.state.drinkRequests).toHaveLength(0);

    const guestTopUp = guest.locator(".pg-drink-card").filter({
      has: guest.getByRole("heading", { name: "Add chips" }),
    });
    const guestDrink = guestTopUp.getByLabel("Drink", { exact: true });
    await guestDrink.selectOption("finish");
    hub.receive("Alice", {
      type: "drinking-rules",
      rules: { ...hub.state.config.drinkingRules, finishEnabled: false },
    });
    await expect(guestDrink).toHaveValue("sip");
    await expect(guestTopUp.getByLabel("Quantity")).toBeVisible();
    await expect(
      guestTopUp.getByRole("button", { name: /Request verification/ }),
    ).toBeEnabled();

    // A delayed payout can have returned the controller to its Play view.
    await host.getByRole("tab", { name: "Drinks", exact: true }).click();
    await expect(host.locator(".pg-drinks svg.drink-icon")).toHaveCount(3);
    await expect(
      host
        .getByRole("tab", { name: "Drinks", exact: true })
        .locator(".drink-icon"),
    ).toHaveAttribute("width", "21");
    expect(
      await guest
        .locator(".pg-drinks")
        .evaluate((el) => el.scrollWidth <= el.clientWidth),
    ).toBe(true);
    expect(errors).toEqual([]);
    if (!process.env.CI) {
      await mkdir("artifacts", { recursive: true });
      await expect(host.locator("[data-bank-value]")).toHaveAttribute(
        "data-bank-value",
        "4250",
      );
      await host.locator(".pg-drinks").evaluate((el) => el.scrollTo(0, 0));
      await host.screenshot({ path: "artifacts/drinking-mode-phone.png" });
    }
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
    hub.close();
  }
});
