import { expect, test } from "@playwright/test";
import { HOUSE_RULES } from "../../src/house-rules.js";
import { RoomHub } from "../../src/hub.js";

test.use({ viewport: { width: 320, height: 640 }, hasTouch: true });

test("players can scroll to and buy the last House Rules offer", async ({
  page,
}) => {
  const code = "RULES9";
  const hub = new RoomHub(code);
  try {
    await page.route("**/api/config", (route) =>
      route.fulfill({ json: { local: true, code } }),
    );
    await page.routeWebSocket("**/socket", (socket) => {
      hub.connect("host", (message) => socket.send(JSON.stringify(message)));
      socket.onMessage((message) => hub.receive("host", JSON.parse(message)));
      socket.onClose(() => hub.disconnect("host"));
    });
    await page.goto(`/join?code=${code}`);
    await page.getByLabel("Your name").fill("Alex");
    await page.getByRole("button", { name: "Join", exact: true }).click();
    const start = page.getByRole("button", { name: "Open the table" });
    await expect(start).toBeVisible();
    for (const rule of Object.keys(HOUSE_RULES)) {
      hub.receive("host", { type: "house-rule", rule, value: "purchase" });
    }
    await start.click();
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
    const bank = hub.state.players[0].bank;
    await lastOffer.click();
    await expect(shop.getByText("Active", { exact: true })).toBeVisible();
    expect(hub.state.players[0].bank).toBeLessThan(bank);
  } finally {
    await hub.close();
  }
});
