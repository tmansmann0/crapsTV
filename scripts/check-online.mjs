// Optional live smoke test: requires the public PeerJS signaling service.
import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import assert from "node:assert/strict";
const url = process.env.ONLINE_URL || "https://tmansmann0.github.io/crapsTV/";
const browser = await chromium.launch({
  headless: true,
  args: [
    process.platform === "darwin"
      ? "--use-angle=metal"
      : "--use-angle=swiftshader",
    "--enable-webgl",
  ],
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
  const scene = host.getByTestId("casino-scene");
  await scene.waitFor();
  await host.waitForFunction(
    () =>
      document.querySelector('[data-testid="casino-scene"]')?.dataset.roomCode
        ?.length === 6,
  );
  await host.getByRole("status").filter({ hasText: "connected" }).waitFor();
  const code = await scene.getAttribute("data-room-code");
  await host.waitForTimeout(1500);
  await host.screenshot({
    path: "artifacts/online-landing.png",
    fullPage: true,
  });
  console.log("Online room opened:", code);
  const joinURL = new URL("join", url);
  joinURL.searchParams.set("code", code);
  await phone.goto(joinURL.href);
  await phone
    .getByRole("heading", { name: "Join table" })
    .waitFor({ timeout: 30000 });
  await phone.getByLabel("Your name").fill("Online Tester");
  await phone.getByRole("button", { name: "Join", exact: true }).click();
  await phone.getByText("Table setup").waitFor();
  await phone.getByRole("button", { name: "Crapless craps" }).click();
  await phone.getByLabel("Betting window (seconds)").fill("0");
  await phone.getByRole("button", { name: "Open the table" }).click();
  await phone.getByRole("tab", { name: "Play", exact: true }).waitFor();
  await phone.locator('[data-bet-id="pass"]').click();
  await phone.getByRole("button", { name: /Place \$5/ }).click();
  await phone.getByRole("tab", { name: "Roll", exact: true }).click();
  await phone.getByRole("button", { name: "blue dice", exact: true }).click();
  await phone
    .getByRole("button", { name: "Translucent dice", exact: true })
    .click();
  await host.waitForFunction(
    () =>
      document.querySelector(".table-canvas")?.dataset.diceFinish ===
      "translucent",
  );
  await phone.getByRole("button", { name: "Open settings" }).click();
  await phone.locator("summary").click();
  await phone.getByLabel("TV camera").selectOption("room");
  await host.waitForFunction(
    () => document.querySelector(".table-canvas")?.dataset.camera === "room",
  );
  await phone.getByRole("button", { name: "Close settings" }).click();
  await phone.getByTestId("phone-dice").locator("canvas").waitFor();
  const box = await phone.getByTestId("phone-dice").boundingBox();
  await phone.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.85);
  await phone.mouse.down();
  await phone.mouse.move(box.x + box.width * 0.65, box.y + box.height * 0.25, {
    steps: 12,
  });
  await phone.mouse.up();
  await phone.locator(".pg-strip.is-result").waitFor();
  await host.screenshot({ path: "artifacts/online-table.png", fullPage: true });
  await phone.reload();
  await phone.locator(".pg-shell").waitFor({ timeout: 30000 });
  await phone.getByRole("button", { name: "Open settings" }).click();
  await phone.locator("summary").click();
  await phone.getByRole("button", { name: "Close table for everyone" }).click();
  await phone
    .getByRole("button", { name: "Close for everyone", exact: true })
    .click();
  await host
    .getByRole("status")
    .filter({ hasText: "Session closed" })
    .waitFor();
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      ok: true,
      url,
      code,
      mode: "crapless",
      flow: "static host → remote phone → chip bet → shared swipe throw → reconnect → close",
      errors,
    }),
  );
} finally {
  await browser.close();
}
