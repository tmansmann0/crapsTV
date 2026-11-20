import { mkdir } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { finishRoll } from "../../src/game.js";
import { RoomHub } from "../../src/hub.js";

test("two phones verify top-ups and spend winnings on an optional offer", async ({
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
    await host.getByLabel("Offer markup (%)").fill("25");
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
      .filter({ has: host.getByRole("heading", { name: "Offer a drink" }) });
    await expect(add.locator("option[value=sip]")).toHaveText("Sip · $6");
    await expect(offer.locator("option[value=shot]")).toHaveText("Shot · $25");
    await expect(
      offer.getByRole("button", { name: /Send offer/ }),
    ).toBeDisabled();
    await add.getByLabel("Drink", { exact: true }).selectOption("finish");
    await expect(add.getByLabel("Quantity")).toHaveCount(0);
    await add.getByRole("button", { name: /Request verification/ }).click();
    await expect(add.getByText(/Waiting for verification/)).toBeVisible();
    expect(alice.bank).toBe(0);
    await guest.getByRole("tab", { name: /Drinks/ }).click();
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
    const sendOffer = offer.getByRole("button", { name: /Send offer/ });
    await offer.getByLabel("Drink", { exact: true }).selectOption("finish");
    await expect(sendOffer).toHaveText(/\$37\.50/);
    await sendOffer.click();
    await expect(offer.getByText(/Waiting for the recipient/)).toBeVisible();
    await guest.getByRole("button", { name: "Decline", exact: true }).click();
    await expect(sendOffer).toBeEnabled();
    expect(alice.bank).toBe(8000);

    await sendOffer.click();
    await guest.getByRole("button", { name: "Accept offer" }).click();
    await expect(host.locator(".pg-drink-hero")).toContainText("$12.50");
    expect([alice.bank, alice.buyIn, jordan.bank]).toEqual([4250, 3000, 0]);
    expect(hub.state.drinkRequests).toHaveLength(0);
    const assets = await host
      .locator(".pg-drinks img")
      .evaluateAll((images) =>
        images.every((image) => image.complete && image.naturalWidth > 0),
      );
    expect(assets).toBe(true);
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
