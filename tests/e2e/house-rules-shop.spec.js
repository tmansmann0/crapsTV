import { expect, test } from "@playwright/test";
import { HOUSE_RULES } from "../../src/house-rules.js";
import { RoomHub } from "../../src/hub.js";

test.use({ viewport: { width: 320, height: 640 }, hasTouch: true });

test("players can scroll to buy an upgrade for the whole table", async ({
  page,
  browser,
  baseURL,
}) => {
  const code = "RULES9";
  const hub = new RoomHub(code);
  async function join(controller, name) {
    await controller.route("**/api/config", (route) =>
      route.fulfill({ json: { local: true, code } }),
    );
    await controller.routeWebSocket("**/socket", (socket) => {
      hub.connect(name, (message) => socket.send(JSON.stringify(message)));
      socket.onMessage((message) => hub.receive(name, JSON.parse(message)));
      socket.onClose(() => hub.disconnect(name));
    });
    await controller.goto(`/join?code=${code}`);
    await controller.getByLabel("Your name").fill(name);
    await controller.getByRole("button", { name: "Join", exact: true }).click();
  }

  const guest = await browser.newPage({ baseURL });
  try {
    await join(page, "Alex");
    await join(guest, "Chris");
    const start = page.getByRole("button", { name: "Open the table" });
    await expect(start).toBeVisible();
    for (const rule of Object.keys(HOUSE_RULES)) {
      hub.receive("Alex", { type: "house-rule", rule, value: "purchase" });
    }
    await start.click();
    await guest.getByRole("tab", { name: "House Rules" }).click();
    const guestShop = guest.getByRole("region", { name: "House Rules" });
    const guestJackpot = guestShop.getByRole("listitem").filter({
      has: guest.getByRole("heading", { name: "Table Jackpot" }),
    });
    await expect(
      guestJackpot.getByRole("button", { name: /^Buy/ }),
    ).toHaveCount(1);
    await page.bringToFront();
    const rulesTab = page.getByRole("tab", { name: "House Rules" });
    await rulesTab.click();
    const shop = page.getByRole("region", { name: "House Rules" });
    const lastOffer = shop.getByRole("button", { name: /^Buy Table Jackpot/ });
    await expect(lastOffer).not.toBeInViewport();

    const bounds = await shop.boundingBox();
    const navBefore = await rulesTab.boundingBox();
    await page.mouse.move(bounds.x + 85, bounds.y + 165);
    await page.mouse.wheel(0, 2400);

    await expect(lastOffer).toBeInViewport({ ratio: 1 });
    expect(await rulesTab.boundingBox()).toEqual(navBefore);
    expect(await shop.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(
      true,
    );
    const [buyer, other] = hub.state.players;
    const bank = buyer.bank;
    const guestBank = other.bank;
    await lastOffer.click();
    await expect(shop.getByText("Active", { exact: true })).toBeVisible();
    await expect(
      guestJackpot.getByText("Active", { exact: true }),
    ).toBeVisible();
    await expect(
      guestJackpot.getByText("5 rolls", { exact: true }),
    ).toBeVisible();
    await expect(
      guestJackpot.getByRole("button", { name: /^Buy/ }),
    ).toHaveCount(0);
    expect(buyer.bank).toBeLessThan(bank);
    expect(other.bank).toBe(guestBank);
  } finally {
    await guest.close();
    await hub.close();
  }
});
