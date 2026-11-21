import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";
import { startTestHost } from "./test-host.mjs";
import { clickTV } from "../tests/helpers/tv-actions.mjs";

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

  await host.goto(server.url + "/android-host?view=settings");
  await expect(host.getByText("Shared network ready")).toBeVisible();
  await expect(
    host.getByRole("button", { name: "Create offline Wi-Fi" }),
  ).toBeHidden();
  await host.getByRole("button", { name: "Show game QR" }).click();
  const gameQR = host.getByAltText("Scan to join the CrapsTV table");
  await expect(gameQR).toBeVisible();
  assert((await gameQR.boundingBox()).width >= 280);
  await expect(host.getByText("2 · Join the game")).toBeHidden();

  await server.updateNetwork({ mode: "lan" });
  await expect(
    host.getByRole("button", { name: "Create offline Wi-Fi" }),
  ).toBeVisible();
  await expect(gameQR).toBeHidden();
  await host.goto(server.url + "/android-host?view=setup");
  await server.updateNetwork({ mode: "starting" });
  await expect(
    host.getByRole("button", { name: "Creating offline Wi-Fi…" }),
  ).toBeDisabled();
  await server.updateNetwork({
    mode: "local-only",
    ip: "127.0.0.1",
    ssid: "TEST-OFFLINE",
    password: "test-wifi-pass",
  });
  const wifiQR = host.getByAltText("Scan to join the offline Wi-Fi");
  await expect(wifiQR).toBeVisible();
  await expect(wifiQR).toHaveAttribute(
    "src",
    /^\/android\/qr.svg\?kind=wifi&rev=\d+$/,
  );
  await host.getByText("Enter Wi-Fi details manually").click();
  await expect(host.getByText("TEST-OFFLINE", { exact: true })).toBeVisible();
  await expect(host.getByText("test-wifi-pass", { exact: true })).toBeVisible();
  await host.getByRole("button", { name: "Show game QR" }).click();
  await expect(gameQR).toBeVisible();
  await expect(host.getByText("test-wifi-pass", { exact: true })).toBeHidden();
  await expect(host.getByText("2 · Join the game")).toBeVisible();

  await server.updateNetwork({ mode: "lan", ip: "127.0.0.1" });
  await expect(host.getByText("2 · Join the game")).toBeHidden();

  if (process.argv.includes("--table")) {
    const tv = await context.newPage();
    tv.on("pageerror", (error) => errors.push(error.message));
    await tv.setViewportSize({ width: 760, height: 420 });
    await tv.goto(server.url + "/");
    const scene = tv.locator(".table-canvas");
    await expect(scene).toHaveAttribute("data-scene-ready", "true", {
      timeout: 90000,
    });
    if ((await scene.getAttribute("data-graphics-intro")) === "true")
      await tv.keyboard.press("Escape");
    await expect(scene).toHaveAttribute("data-graphics-intro", "false");
    assert(!JSON.parse(await scene.getAttribute("data-ui-actions")).join);
    await clickTV(tv, "settings");
    await expect
      .poll(
        async () =>
          !!JSON.parse(await scene.getAttribute("data-ui-actions"))[
            "host-network"
          ],
      )
      .toBe(true);
    await tv.evaluate(() => {
      window.hostTestCanvas = document.querySelector(".table-canvas canvas");
    });
    await clickTV(tv, "join");
    const panel = tv.frameLocator(".android-host-panel iframe");
    await expect(
      panel.getByAltText("Scan to join the CrapsTV table"),
    ).toBeVisible();
    await expect(
      panel.getByRole("button", { name: "Create offline Wi-Fi" }),
    ).toBeHidden();
    await panel.getByRole("button", { name: "Done" }).click();
    await clickTV(tv, "host-network");
    await expect(panel.getByText("Shared network ready")).toBeVisible();
    await panel.getByRole("button", { name: "Done" }).click();
    assert(
      await tv.evaluate(
        () =>
          window.hostTestCanvas ===
          document.querySelector(".table-canvas canvas"),
      ),
    );
    await expect(scene).toHaveAttribute("data-graphics-intro", "false");
    await tv.close();
  }
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
