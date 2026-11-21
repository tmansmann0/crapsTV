import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";
import { startTestHost } from "./test-host.mjs";

const server = await startTestHost({ mode: "lan", ip: "127.0.0.1" });
const errors = [];
const external = [];
let browser;
async function offlineContext() {
  const context = await browser.newContext({
    viewport: { width: 360, height: 740 },
  });
  await context.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== server.url) {
      external.push(url.origin);
      return route.abort();
    }
    return route.continue();
  });
  return context;
}

try {
  browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || undefined,
    headless: true,
    args: [
      process.platform === "darwin"
        ? "--use-angle=metal"
        : "--use-angle=swiftshader",
    ],
  });
  const context = await offlineContext();
  const host = await context.newPage();
  host.on("pageerror", (error) => errors.push(error.message));

  await host.goto(server.url + "/android-host");
  await expect(host.getByText("Local network ready")).toBeVisible();
  const gameQR = host.getByAltText("Scan to join the game. Tap to enlarge.");
  await expect(gameQR).toBeVisible();
  await expect(host.getByAltText(/scan to join the offline/i)).toBeHidden();
  const regular = await gameQR.boundingBox();
  assert(regular.width >= 280);

  await gameQR.click();
  await host.waitForURL("**/android-qr?kind=game");
  const fullGameQR = host.getByAltText("Join game QR", { exact: true });
  await expect(fullGameQR).toBeVisible();
  assert((await fullGameQR.boundingBox()).width > regular.width);
  await host.getByRole("link", { name: "Back to pairing" }).click();
  await host.getByRole("link", { name: "1. Join Wi-Fi" }).click();
  await expect(
    host.getByRole("link", { name: "Create offline Wi-Fi" }),
  ).toHaveAttribute("href", "crapstv://host/offline");

  await server.updateNetwork({ mode: "starting" });
  await expect(host.getByText("Creating Wi-Fi…")).toBeVisible();
  await expect(host.getByRole("link", { name: "Show game QR" })).toBeHidden();
  await server.updateNetwork({
    mode: "local-only",
    ip: "127.0.0.1",
    ssid: "TEST-OFFLINE",
    password: "test-wifi-pass",
  });
  const wifiQR = host.getByAltText(
    "Scan to join the offline Wi-Fi. Tap to enlarge.",
  );
  await expect(wifiQR).toBeVisible();
  await expect(wifiQR).toHaveAttribute(
    "src",
    /^\/android\/qr.svg\?kind=wifi&rev=\d+$/,
  );
  await host.getByText("Enter Wi-Fi details manually").click();
  await expect(host.getByText("TEST-OFFLINE", { exact: true })).toBeVisible();
  await expect(host.getByText("test-wifi-pass", { exact: true })).toBeVisible();
  await wifiQR.click();
  await host.waitForURL("**/android-qr?kind=wifi");
  await expect(
    host.getByAltText("Join Wi-Fi QR", { exact: true }),
  ).toBeVisible();
  await host.getByRole("link", { name: "Back to pairing" }).click();
  await host.getByRole("link", { name: "Show game QR" }).click();
  await expect(gameQR).toBeVisible();
  await expect(host.getByText("test-wifi-pass", { exact: true })).toBeHidden();

  // A network change updates the URL on the open pairing page.
  await server.updateNetwork({ mode: "lan" });
  await expect(host.getByRole("link", { name: "Set up Wi-Fi" })).toBeVisible();
  await expect(gameQR).toBeHidden();
  await server.updateNetwork({ mode: "lan", ip: "127.0.0.1" });
  await expect(gameQR).toBeVisible();
  const cfg = await (
    await context.request.get(server.url + "/api/config")
  ).json();

  async function player(playerContext, name) {
    const page = await playerContext.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(server.url + "/join?code=" + cfg.code);
    await page.getByLabel("Your name").fill(name);
    await page.getByRole("button", { name: "Join", exact: true }).click();
    return page;
  }
  const a = await player(context, "Host");
  await a.getByText("Table setup").waitFor();
  const b = await player(await offlineContext(), "Guest");
  await b.getByText("Your chips are waiting.").waitFor();
  await a.getByRole("button", { name: "Open the table" }).click();
  await a.getByRole("tab", { name: "Play", exact: true }).waitFor();
  await b.getByRole("tab", { name: "Play", exact: true }).waitFor();
  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
  console.log(
    "PASS: LAN pairing, offline Wi-Fi and game QR steps, network recovery, two offline browser players, and no external requests.",
  );
} finally {
  await browser?.close();
  await server.stop();
}
