import { mkdir } from "node:fs/promises";
import { test } from "@playwright/test";
import assert from "node:assert/strict";
test("TV and phones complete a session, reconnect and export a recap", async ({
  browser,
}) => {
  await mkdir("artifacts", { recursive: true });
  const errors = [];
  const tv = await browser.newPage({ viewport: { width: 1440, height: 1040 } });
  tv.on("pageerror", (e) => errors.push(e.message));
  await tv.goto("http://127.0.0.1:4321");
  await tv.getByText("The table is yours.").waitFor();
  await tv.waitForTimeout(2300);
  await tv.screenshot({ path: "artifacts/tv-lobby.png", fullPage: true });
  const cfg = await (
    await tv.request.get("http://127.0.0.1:4321/api/config")
  ).json();
  const phone = await browser.newPage({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    deviceScaleFactor: 2,
  });
  phone.on("pageerror", (e) => errors.push(e.message));
  await phone.goto(`http://127.0.0.1:4321/?join=${cfg.code}`);
  await phone.getByRole("heading", { name: "Take a seat." }).waitFor();
  await phone.getByLabel("Your name").fill("Tyler");
  await phone.getByRole("button", { name: "I’m feeling lucky" }).click();
  await phone.getByText("Set the night in motion.").waitFor();
  await phone.screenshot({ path: "artifacts/phone-setup.png", fullPage: true });
  const bob = await browser.newPage({
    viewport: { width: 390, height: 844 },
    isMobile: true,
  });
  bob.on("pageerror", (e) => errors.push(e.message));
  await bob.goto(`http://127.0.0.1:4321/?join=${cfg.code}`);
  await bob.getByRole("heading", { name: "Take a seat." }).waitFor();
  await bob.getByLabel("Your name").fill("Jordan");
  await bob.getByRole("button", { name: "I’m feeling lucky" }).click();
  await bob.getByText("Your chips are waiting.").waitFor();
  await phone.getByRole("button", { name: "Open the table" }).click();
  await phone.getByRole("button", { name: "Roll the dice" }).waitFor();
  await phone
    .getByRole("button", { name: "Place bet", exact: false })
    .first()
    .click();
  await phone.getByRole("tab", { name: "My bets (1)" }).waitFor();
  await bob.getByRole("button", { name: "One roll", exact: true }).click();
  await bob
    .getByRole("button", { name: "Place bet", exact: false })
    .first()
    .click();
  await phone.screenshot({
    path: "artifacts/phone-playing.png",
    fullPage: true,
  });
  await phone.getByRole("button", { name: "Roll the dice" }).click();
  await phone.getByRole("button", { name: "Dice are rolling…" }).waitFor();
  await phone.getByRole("button", { name: "Roll the dice" }).waitFor();
  await tv.screenshot({ path: "artifacts/tv-playing.png", fullPage: true });
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
  await phone.screenshot({ path: "artifacts/phone-recap.png", fullPage: true });
  await tv.screenshot({ path: "artifacts/tv-recaps.png", fullPage: true });
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
