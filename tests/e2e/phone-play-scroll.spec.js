import { expect, test } from "@playwright/test";
import { adjustBankroll, place } from "../../src/game.js";
import { RoomHub } from "../../src/hub.js";

test.use({ viewport: { width: 320, height: 500 }, hasTouch: true });

test("the Play pane exposes Pass Odds with an empty Drinking Mode bank", async ({
  page,
}) => {
  const code = "ODDS99";
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
    await page.getByRole("button", { name: /Drinking Mode/ }).click();
    await page.getByRole("button", { name: "Open the table" }).click();
    const playTab = page.getByRole("tab", { name: "Play" });
    await expect(playTab).toBeVisible();

    const { state } = hub;
    const [player] = state.players;
    adjustBankroll(state, player.id, player.id, 1000);
    place(state, player.id, "pass", 500);
    const pass = player.bets[0];
    state.point = pass.point = 4;
    place(state, player.id, `odds:${pass.id}`, 500);
    hub.broadcast();

    expect(player.bank).toBe(0);
    await expect(
      page.getByRole("button", { name: "Add chips in Drinks" }),
    ).toBeVisible();
    const pane = page.getByRole("tabpanel", { name: "Play" });
    const passOdds = pane.getByRole("button", { name: /^Take odds · pass 4/ });
    await expect(passOdds).toBeAttached();
    await expect(passOdds).not.toBeInViewport();
    const bounds = await pane.boundingBox();
    const navBefore = await playTab.boundingBox();
    await page.mouse.move(bounds.x + 85, bounds.y + 165);
    await page.mouse.wheel(0, 900);

    await expect(passOdds).toBeInViewport({ ratio: 1 });
    expect(await playTab.boundingBox()).toEqual(navBefore);
    await passOdds.click();
    const remove = pane.getByRole("button", {
      name: /^Take down Take odds · pass 4/,
    });
    await remove.click();
    await expect.poll(() => player.bank).toBe(500);
    expect(player.bets.map((bet) => bet.type)).toEqual(["pass"]);
    await pane
      .getByRole("button", { name: /^Bet \$5 on Take odds · pass 4/ })
      .click();
    await expect.poll(() => player.bank).toBe(0);
    expect(player.bets.map((bet) => bet.type)).toEqual(["pass", "odds"]);

    await page.getByRole("tab", { name: /^Roll/ }).click();
    const dice = page.getByRole("region", { name: "Dice throw" });
    const translucent = dice.getByRole("button", { name: "Translucent dice" });
    const diceBounds = await dice.boundingBox();
    await page.mouse.move(diceBounds.x + 25, diceBounds.y + 20);
    await page.mouse.wheel(0, 530);
    await expect(translucent).toBeInViewport({ ratio: 1 });
    await translucent.click();
    await expect(translucent).toHaveAttribute("aria-pressed", "true");
  } finally {
    await hub.close();
  }
});
