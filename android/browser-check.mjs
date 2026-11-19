import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || "/usr/bin/chromium",
  headless: true,
  args: ["--no-sandbox", "--use-angle=swiftshader"],
});
const errors = [],
  external = [];
try {
  const context = await browser.newContext({
    viewport: { width: 360, height: 740 },
  });
  await context.route("**/*", (route) => {
    const u = new URL(route.request().url());
    if (u.hostname !== "127.0.0.1") {
      external.push(u.origin);
      return route.abort();
    }
    return route.continue();
  });
  const host = await context.newPage();
  host.on("pageerror", (e) => errors.push(e.message));
  await host.goto("http://127.0.0.1:3000/android-host");
  await host.locator("#qr").waitFor();
  assert.equal(await host.locator("img").count(), 1);
  assert.equal(await host.getByText(/Password:/).count(), 0);
  const small = await host.locator("#qr").boundingBox();
  assert(small.width >= 280);
  await host.locator("#qr").click();
  await host.waitForURL("**/android-qr?kind=game");
  const large = await host.locator("#qr").boundingBox();
  assert(large.width > small.width);
  await host.goBack();
  await host.locator("#qr").waitFor();
  await host.goto("http://127.0.0.1:3000/android-network");
  await host.getByText("Network: TEST-OFFLINE").waitFor();
  assert.equal(await host.locator("#qr").count(), 1);
  const cfg = await (
    await context.request.get("http://127.0.0.1:3000/api/config")
  ).json();
  const a = await context.newPage();
  await a.goto(`http://127.0.0.1:3000/join?code=${cfg.code}`);
  await a.getByLabel("Your name").fill("Host");
  await a.getByRole("button", { name: "Join", exact: true }).click();
  await a.getByText("Table setup").waitFor();
  const b = await (await browser.newContext()).newPage();
  await b
    .context()
    .route("**/*", (route) =>
      new URL(route.request().url()).hostname === "127.0.0.1"
        ? route.continue()
        : route.abort(),
    );
  await b.goto(`http://127.0.0.1:3000/join?code=${cfg.code}`);
  await b.getByLabel("Your name").fill("Guest");
  await b.getByRole("button", { name: "Join", exact: true }).click();
  await b.getByText("Your chips are waiting.").waitFor();
  await a.getByRole("button", { name: "Open the table" }).click();
  await a.getByRole("tab", { name: "Play", exact: true }).waitFor();
  await b.getByRole("tab", { name: "Play", exact: true }).waitFor();
  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
  console.log(
    "PASS: 360px host single game QR, enlarge/history Back, secondary Wi-Fi QR, two browser players start; external requests blocked and none attempted.",
  );
} finally {
  await browser.close();
}
