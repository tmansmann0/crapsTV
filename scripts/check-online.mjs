// Optional live smoke test: requires the public PeerJS signaling service.
import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import assert from "node:assert/strict";
const url = process.env.ONLINE_URL || "https://tmansmann0.github.io/crapsTV/";
const browser = await chromium.launch({
  headless: true,
  args: ["--use-angle=swiftshader", "--enable-webgl"],
});
try {
  await mkdir("artifacts", { recursive: true });
  const host = await browser.newPage({
      viewport: { width: 1440, height: 1000 },
    }),
    phone = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  for (const p of [host, phone])
    p.on("pageerror", (e) => errors.push(e.message));
  await host.goto(url);
  await host.getByRole("button", { name: "Host an online table" }).waitFor();
  await host.waitForTimeout(1500);
  await host.screenshot({
    path: "artifacts/online-landing.png",
    fullPage: true,
  });
  await host.getByRole("button", { name: "Host an online table" }).click();
  await host
    .getByText("Table connected", { exact: true })
    .waitFor({ timeout: 30000 });
  const code = await host.locator(".join-card h2").innerText();
  console.log("Online room opened:", code);
  const joinURL = new URL(url);
  joinURL.searchParams.set("join", code);
  await phone.goto(joinURL.href);
  await phone
    .getByRole("heading", { name: "Take a seat." })
    .waitFor({ timeout: 30000 });
  await phone.getByLabel("Your name").fill("Online Tester");
  await phone.getByRole("button", { name: "I’m feeling lucky" }).click();
  await phone.getByText("Set the night in motion.").waitFor();
  await phone.getByRole("button", { name: "Crapless craps" }).click();
  await phone.getByRole("button", { name: "Open the table" }).click();
  await phone.getByRole("button", { name: "Roll the dice" }).waitFor();
  await phone
    .getByRole("button", { name: "Place bet", exact: false })
    .first()
    .click();
  await phone.getByRole("button", { name: "Roll the dice" }).click();
  await phone.getByRole("button", { name: "Dice are rolling…" }).waitFor();
  await phone.getByRole("button", { name: "Roll the dice" }).waitFor();
  await host.screenshot({ path: "artifacts/online-table.png", fullPage: true });
  await phone.reload();
  await phone
    .getByRole("button", { name: "Roll the dice" })
    .waitFor({ timeout: 30000 });
  await phone.locator("summary").click();
  await phone.getByRole("button", { name: "Close table for everyone" }).click();
  await phone
    .getByRole("button", { name: "Close for everyone", exact: true })
    .click();
  await host.getByRole("heading", { name: "What a night." }).waitFor();
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      ok: true,
      url,
      code,
      mode: "crapless",
      flow: "static host → remote phone → bet → roll → reconnect → close",
      errors,
    }),
  );
} finally {
  await browser.close();
}
