import { mkdir } from "node:fs/promises";
import { test, expect } from "@playwright/test";
import assert from "node:assert/strict";
// Software WebGL readbacks can stall shared CI runners. Visual QA snapshots are
// captured locally; CI retains every interaction/assertion and DOM trace.
async function capture(page, options) {
  if (!process.env.CI) await page.screenshot(options);
}
test("TV and phones complete a session, reconnect and export a recap", async ({
  browser,
}) => {
  await mkdir("artifacts", { recursive: true });
  const errors = [];
  const tv = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  tv.on("pageerror", (e) => errors.push(e.message));
  await tv.goto("http://127.0.0.1:4321");
  const scene = tv.getByTestId("casino-scene");
  await expect(scene).toHaveAttribute("data-room-code", /^[A-Z2-9]{6}$/);
  await expect(tv.locator("header, footer")).toHaveCount(0);
  await expect(tv.locator(".table-canvas canvas")).toHaveCount(1);
  await expect(tv.locator(".table-canvas")).toHaveAttribute(
    "data-environment",
    "casino-room.exr",
    { timeout: 30000 },
  );
  await tv.waitForTimeout(2300);
  await tv.locator("canvas").click({
    position: { x: 48, y: 48 },
  });
  await expect(tv.locator(".table-canvas")).toHaveAttribute(
    "data-settings-open",
    "true",
  );
  await tv.locator("canvas").click({ position: { x: 130, y: 210 } });
  await expect(tv.locator(".table-canvas")).toHaveAttribute(
    "data-camera",
    "table",
  );
  await capture(tv, { path: "artifacts/tv-lobby.png", fullPage: true });
  const cfg = await (
    await tv.request.get("http://127.0.0.1:4321/api/config")
  ).json();
  // The visible controller button is a raycast target inside WebGL, not a DOM overlay.
  const popup = tv.waitForEvent("popup");
  await tv.locator("canvas").click({
    position: { x: 130, y: 305 },
  });
  const phone = await popup;
  await phone.setViewportSize({ width: 390, height: 844 });
  phone.on("pageerror", (e) => errors.push(e.message));
  await phone.getByRole("heading", { name: "Join table" }).waitFor();
  await phone.getByLabel("Your name").fill("Tyler");
  await phone.getByRole("button", { name: "Join", exact: true }).click();
  await phone.getByText("Set the night in motion.").waitFor();
  await capture(phone, { path: "artifacts/phone-setup.png", fullPage: true });
  const bob = await browser.newPage({
    viewport: { width: 390, height: 844 },
    isMobile: true,
  });
  bob.on("pageerror", (e) => errors.push(e.message));
  await bob.goto(`http://127.0.0.1:4321/?join=${cfg.code}`);
  await expect(bob).toHaveURL(`http://127.0.0.1:4321/join?code=${cfg.code}`);
  await bob.getByRole("heading", { name: "Join table" }).waitFor();
  await bob.getByLabel("Your name").fill("Jordan");
  await bob.getByRole("button", { name: "Join", exact: true }).click();
  await bob.getByText("Your chips are waiting.").waitFor();
  await phone.getByRole("button", { name: "Open the table" }).click();
  await phone.getByRole("button", { name: "Roll the dice" }).waitFor();
  await phone.getByRole("button", { name: "blue dice" }).click();
  await phone.getByRole("button", { name: "translucent", exact: true }).click();
  await expect(tv.locator(".table-canvas")).toHaveAttribute(
    "data-dice-color",
    "blue",
  );
  await expect(tv.locator(".table-canvas")).toHaveAttribute(
    "data-dice-finish",
    "translucent",
  );
  await expect(tv.locator(".table-canvas")).toHaveAttribute(
    "data-player-labels",
    "2",
  );
  await phone.locator("summary").click();
  await phone.getByLabel("TV camera").selectOption("room");
  await expect(tv.locator(".table-canvas")).toHaveAttribute(
    "data-camera",
    "room",
  );
  await phone.locator("summary").click();

  await phone
    .getByRole("button", { name: "Place bet", exact: false })
    .first()
    .click();
  await phone.getByRole("tab", { name: "My bets (1)" }).waitFor();
  await expect
    .poll(async () =>
      Number(await tv.locator(".table-canvas").getAttribute("data-chips")),
    )
    .toBeGreaterThan(0);
  await bob.getByRole("button", { name: "One roll", exact: true }).click();
  await bob
    .getByRole("button", { name: "Place bet", exact: false })
    .first()
    .click();
  await capture(phone, {
    path: "artifacts/phone-playing.png",
    fullPage: true,
  });
  await phone.getByRole("button", { name: "Roll the dice" }).click();
  await phone.getByRole("button", { name: "Dice are rolling…" }).waitFor();
  await phone.getByRole("button", { name: "Roll the dice" }).waitFor();
  await capture(tv, { path: "artifacts/tv-playing.png", fullPage: true });
  // Reload must preserve identity and chips, rather than creating another seat.
  await phone.reload();
  await phone.getByRole("button", { name: "Roll the dice" }).waitFor();
  assert.equal(
    await phone.getByRole("heading", { name: "Hey, Tyler" }).count(),
    1,
  );
  await phone.locator("summary").click();
  await phone.getByRole("button", { name: "Close table for everyone" }).click();
  await phone
    .getByRole("button", { name: "Close for everyone", exact: true })
    .click();
  await bob.getByText("YOUR NIGHT, RECAPPED").waitFor();
  const downloadP = phone.waitForEvent("download");
  await phone.getByRole("button", { name: "Save your recap card" }).click();
  const download = await downloadP;
  await download.saveAs("artifacts/recap.png");
  await capture(phone, { path: "artifacts/phone-recap.png", fullPage: true });
  await capture(tv, { path: "artifacts/tv-recaps.png", fullPage: true });
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      ok: true,
      code: cfg.code,
      errors,
      screenshots: "artifacts/",
      download: download.suggestedFilename(),
    }),
  );
});
