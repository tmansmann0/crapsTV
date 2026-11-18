import { mkdir, writeFile } from "node:fs/promises";
import { test, expect } from "@playwright/test";
import assert from "node:assert/strict";
import { upperDieFace } from "../../src/throw-motion.js";
import { clickTV } from "../helpers/tv-actions.mjs";
import { openAdminSection } from "../helpers/admin-controls.mjs";
// Software WebGL readbacks can stall shared CI runners. Visual QA snapshots are
// captured locally; CI retains every interaction/assertion and DOM trace.
async function capture(page, options) {
  if (!process.env.CI) await page.screenshot(options);
}
async function swipeDice(page) {
  const box = await page.getByTestId("phone-dice").boundingBox();
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.85);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.65, box.y + box.height * 0.25, {
    steps: 12,
  });
  await page.mouse.up();
}

test("TV and phones complete a session, reconnect and export a recap", async ({
  browser,
}, testInfo) => {
  // Independent browser GPU processes mirror the physical TV and phones.
  const controllers = await browser
    .browserType()
    .launch({ ...testInfo.project.use.launchOptions, headless: true });
  try {
    await mkdir("artifacts", { recursive: true });
    const errors = [];
    const tv = await browser.newPage({
      // CI uses software rasterization; keep every UI element while limiting pixels.
      viewport: process.env.CI
        ? { width: 960, height: 640 }
        : { width: 1280, height: 800 },
    });
    tv.on("pageerror", (e) => errors.push(e.message));
    let previewPackets = null;
    await tv.routeWebSocket("**/socket", (ws) => {
      const server = ws.connectToServer();
      server.onMessage((raw) => {
        if (previewPackets) previewPackets.push(JSON.parse(raw));
        ws.send(raw);
      });
    });
    const shooterThrows = [];
    let rejectedOnce = false;
    const interceptWagers = (ws) => {
      const server = ws.connectToServer();
      let name = "";
      ws.onMessage((raw) => {
        const message = JSON.parse(raw);
        if (["aim", "roll"].includes(message.type)) shooterThrows.push(message);
        if (message.type === "join") name = message.name || name;
        if (
          name === "Tyler" &&
          message.type === "bet" &&
          message.betId === "pass" &&
          !rejectedOnce
        ) {
          rejectedOnce = true;
          ws.send(
            JSON.stringify({
              type: "error",
              message: "That bet changed. Please retry.",
            }),
          );
        } else server.send(raw);
      });
    };

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
    await expect(tv.locator(".table-canvas")).toHaveAttribute(
      "data-scene-ready",
      "true",
      { timeout: 30000 },
    );
    await tv.waitForTimeout(500);
    await clickTV(tv, "settings");
    await expect(tv.locator(".table-canvas")).toHaveAttribute(
      "data-settings-open",
      "true",
    );
    await clickTV(tv, "camera");
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
    await clickTV(tv, "join");
    const controllerPopup = await popup;
    await controllerPopup.waitForURL(/\/join\?code=/);
    const controllerURL = controllerPopup.url();
    await controllerPopup.close();
    await clickTV(tv, "settings");
    const phone = await controllers.newPage({
      viewport: { width: 390, height: 844 },
    });
    await phone.context().routeWebSocket("**/socket", interceptWagers);
    await phone.goto(controllerURL);
    await phone.bringToFront();
    phone.on("pageerror", (e) => errors.push(e.message));
    await phone.getByRole("heading", { name: "Join table" }).waitFor();
    await phone.getByLabel("Your name").fill("Tyler");
    await phone.getByRole("button", { name: "Join", exact: true }).click();
    await phone.getByText("Table setup").waitFor();
    await expect(
      phone.locator('.setup input[type="checkbox"]'),
    ).not.toBeChecked();
    await capture(phone, { path: "artifacts/phone-setup.png", fullPage: true });
    const bob = await controllers.newPage({
      viewport: { width: 390, height: 844 },
      isMobile: true,
    });
    const guestThrows = [];
    const guestErrors = [];
    let guestSocket;
    await bob.routeWebSocket("**/socket", (ws) => {
      guestSocket = ws.connectToServer();
      ws.onMessage((raw) => {
        const message = JSON.parse(raw);
        if (["aim", "roll"].includes(message.type)) guestThrows.push(message);
        guestSocket.send(raw);
      });
      guestSocket.onMessage((raw) => {
        const message = JSON.parse(raw);
        if (message.type === "error") guestErrors.push(message.message);
        ws.send(raw);
      });
    });
    bob.on("pageerror", (e) => errors.push(e.message));
    await bob.goto(`http://127.0.0.1:4321/?join=${cfg.code}`);
    await expect(bob).toHaveURL(`http://127.0.0.1:4321/join?code=${cfg.code}`);
    await bob.getByRole("heading", { name: "Join table" }).waitFor();
    await bob.getByLabel("Your name").fill("Jordan");
    await bob.getByRole("button", { name: "Join", exact: true }).click();
    await bob.getByText("Your chips are waiting.").waitFor();
    await phone.bringToFront();
    await phone.getByRole("button", { name: "Open the table" }).click();
    await phone.getByRole("tab", { name: "Play", exact: true }).waitFor();
    // Default ten-second betting window is enforced and the local countdown
    // unlocks without a new server broadcast. Dice style stays editable.
    await expect(phone.locator(".pg-strip-text small")).toContainText(
      "Betting open",
    );
    await phone.getByRole("tab", { name: "Roll", exact: true }).click();
    await expect(phone.locator(".dice-roll-button")).toBeDisabled();
    await expect(phone.locator(".dice-roll-button")).toContainText(
      "Betting open",
    );
    await expect(
      phone.getByRole("button", { name: "blue dice", exact: true }),
    ).toBeEnabled();
    await expect(
      phone.getByRole("button", { name: "Roll the dice", exact: true }),
    ).toBeEnabled({ timeout: 15000 });
    // The rest of this multi-roll fixture deliberately uses immediate throws.
    await phone.getByRole("button", { name: "Open settings" }).click();
    await openAdminSection(phone, "Table");
    await phone.getByLabel("Betting window (seconds)").fill("0");
    await phone.getByRole("button", { name: "Save timing" }).click();
    await phone.getByRole("button", { name: "Close settings" }).click();
    await phone.getByRole("tab", { name: "Play", exact: true }).click();
    await expect(phone.locator(".pg-tile-pay")).toHaveCount(0);
    for (const value of [5, 5, 1, 1, 1, 1])
      await phone
        .getByRole("button", { name: `Add $${value} chip`, exact: true })
        .click();
    const initialBundle = await phone
      .getByRole("button", { name: /Bundle of \$19/ })
      .boundingBox();
    const sixTarget = await phone
      .locator('[data-bet-id="place-6"]')
      .boundingBox();
    await phone.mouse.move(
      initialBundle.x + initialBundle.width / 2,
      initialBundle.y + initialBundle.height / 2,
    );
    await phone.mouse.down();
    await phone.mouse.move(
      sixTarget.x + sixTarget.width / 2,
      sixTarget.y + sixTarget.height / 2,
      { steps: 10 },
    );
    await phone.mouse.up();
    await expect(phone.locator(".pg-wallet")).toContainText("$0");
    await expect(
      phone.getByRole("button", { name: /Bet more.*\$24/ }),
    ).toBeVisible();
    await phone.getByRole("button", { name: /Bet less.*\$18/ }).click();
    await expect(phone.locator(".pg-wallet")).toContainText("$18");
    await expect
      .poll(async () =>
        Number(await tv.locator(".table-canvas").getAttribute("data-banks")),
      )
      .toBeGreaterThan(0);
    await phone
      .getByRole("button", { name: "Add $5 chip", exact: true })
      .click();
    await phone.locator('[data-bet-id="pass"]').click();
    await phone.getByRole("button", { name: /Place \$5/ }).click();
    await expect(phone.locator(".pg-notice")).toContainText("That bet changed");
    await expect(
      phone.getByRole("button", { name: /Bundle of \$5/ }),
    ).toBeVisible();
    await phone.getByRole("button", { name: /Place \$5/ }).press("Enter");
    await expect(phone.locator(".pg-wallet")).toContainText("$23");
    await expect(phone.locator(".toast")).toHaveCount(0);
    await phone
      .getByRole("button", { name: "Add $5 chip", exact: true })
      .click();
    await phone
      .getByRole("button", { name: "Add $1 chip", exact: true })
      .click();
    const bundle = await phone
      .getByRole("button", { name: /Bundle of \$6/ })
      .boundingBox();
    const field = await phone.locator('[data-bet-id="field"]').boundingBox();
    await phone.mouse.move(
      bundle.x + bundle.width / 2,
      bundle.y + bundle.height / 2,
    );
    await phone.mouse.down();
    await phone.mouse.move(
      field.x + field.width / 2,
      field.y + field.height / 2,
      { steps: 10 },
    );
    await phone.mouse.up();
    await expect(phone.locator(".pg-wallet")).toContainText("$29");
    await expect
      .poll(async () =>
        Number(await tv.locator(".table-canvas").getAttribute("data-chips")),
      )
      .toBeGreaterThan(0);
    await bob.bringToFront();
    await bob.locator('[data-bet-id="field"]').click();
    await bob.getByRole("button", { name: /Place \$5/ }).click();
    await phone.bringToFront();
    await capture(phone, {
      path: "artifacts/phone-playing.png",
      fullPage: true,
    });
    const bankBefore = await phone.locator(".pg-wallet dd").allTextContents();
    await phone.getByRole("tab", { name: "Learn", exact: true }).click();
    await phone
      .getByRole("combobox", { name: "Choose a lesson" })
      .selectOption("odds");
    await phone.getByRole("button", { name: "Next step", exact: true }).click();
    await expect(phone.locator(".learn-center")).toHaveAttribute(
      "data-step",
      "1",
    );
    await expect(phone.locator(".lc-caption")).toContainText("behind Pass");
    await phone.setViewportSize({ width: 375, height: 640 });
    await expect
      .poll(() =>
        phone.evaluate(() => {
          const controls = document
            .querySelector(".lc-controls")
            ?.getBoundingClientRect();
          const nav = document
            .querySelector(".pg-nav")
            ?.getBoundingClientRect();
          return !!controls && !!nav && controls.bottom <= nav.top + 1;
        }),
      )
      .toBe(true);
    await capture(phone, {
      path: "artifacts/learn-integrated-375.png",
      fullPage: true,
    });
    await phone.setViewportSize({ width: 390, height: 844 });
    expect(await phone.locator(".pg-wallet dd").allTextContents()).toEqual(
      bankBefore,
    );
    await capture(phone, {
      path: "artifacts/phone-tutorial.png",
      fullPage: true,
    });
    await phone.getByRole("tab", { name: "Roll", exact: true }).click();
    await expect(phone.getByTestId("phone-dice")).toHaveAttribute(
      "data-loaded",
      "true",
    );
    await phone.getByRole("button", { name: "blue dice", exact: true }).click();
    await phone
      .getByRole("button", { name: "Translucent dice", exact: true })
      .click();
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
    await phone.getByRole("button", { name: "Open settings" }).click();
    await openAdminSection(phone, "TV");
    await phone.getByLabel("TV camera").selectOption("room");
    await expect(tv.locator(".table-canvas")).toHaveAttribute(
      "data-camera",
      "room",
    );
    // Explicit room/table views stay fixed. Auto opts into throw direction.
    await phone.getByLabel("TV camera").selectOption("auto");
    await expect(tv.locator(".table-canvas")).toHaveAttribute(
      "data-camera",
      "auto",
    );
    // Table management can change hands while the shooter keeps the dice.
    await openAdminSection(phone, "Players");
    await phone
      .locator(".ha-disclosure > summary")
      .filter({ hasText: "Pass host controls" })
      .click();
    await phone
      .getByLabel("Pass host controls", { exact: true })
      .selectOption({ label: "Jordan" });
    await phone.getByRole("button", { name: "Close settings" }).click();
    await bob.bringToFront();
    await expect(bob.locator(".pg-identity small")).toContainText("Host");
    await expect(
      bob.getByRole("tab", { name: "Roll", exact: true }),
    ).toHaveCount(0);
    await bob.getByRole("tab", { name: "Dice", exact: true }).click();
    await expect(
      bob.getByText("Tyler has the dice", { exact: true }).last(),
    ).toBeVisible();
    await expect(bob.getByTestId("phone-dice")).toHaveAttribute(
      "aria-label",
      "Dice close-up",
    );
    await expect(
      bob.getByRole("button", { name: "Roll the dice", exact: true }),
    ).toHaveCount(0);
    await swipeDice(bob);
    expect(guestThrows).toEqual([]);
    // A stale client can still submit its old commands through the socket.
    guestSocket.send(JSON.stringify({ type: "aim", aim: { x: 0, power: 1 } }));
    guestSocket.send(JSON.stringify({ type: "roll" }));
    await expect
      .poll(() => guestErrors)
      .toEqual([
        "Only the current shooter can throw the dice.",
        "Only the current shooter can throw the dice.",
      ]);
    await expect(bob.locator(".pg-strip.is-rolling")).toHaveCount(0);
    await phone.bringToFront();
    await expect(
      phone.getByRole("button", { name: "Roll the dice", exact: true }),
    ).toBeEnabled();
    const aimView = phone.getByTestId("phone-dice");
    const aimArt = aimView.locator("svg.dice-aim-preview");
    await expect(aimArt).toHaveAttribute("data-color", "blue");
    await expect(aimArt).toHaveAttribute("data-finish", "translucent");
    await expect(aimView.locator("canvas")).toHaveCount(0);
    if (!process.env.CI || process.env.CRAPSTV_CAPTURE_AIM)
      await phone
        .locator(".dice-throw")
        .screenshot({ path: "artifacts/phone-aim-ready.png" });
    await phone.setViewportSize({ width: 375, height: 640 });
    await aimView.scrollIntoViewIfNeeded();
    expect(
      await phone.evaluate(() => document.documentElement.scrollWidth),
    ).toBe(375);
    await tv.evaluate(() => {
      const table = document.querySelector(".table-canvas");
      window.previewFrames = [];
      window.previewObserver = new MutationObserver(() => {
        if (table.dataset.aim)
          window.previewFrames.push({
            at: performance.now(),
            aim: JSON.parse(table.dataset.aim),
          });
      });
      window.previewObserver.observe(table, {
        attributes: true,
        attributeFilter: ["data-aim"],
      });
    });
    previewPackets = [];
    const box = await aimView.boundingBox();
    const startX = Math.round(box.x + box.width * 0.5);
    const startY = Math.round(box.y + box.height * 0.79);
    await aimView.evaluate((view) => {
      view.addEventListener(
        "pointerdown",
        (e) => {
          view.dataset.testPointer = e.pointerId;
        },
        { once: true },
      );
    });
    await phone.mouse.move(startX, startY);
    await phone.mouse.down();
    const local = await aimView.evaluate(
      async (view, { startX, startY }) => {
        const samples = [];
        const pointerId = Number(view.dataset.testPointer);
        for (let i = 1; i <= 36; i++) {
          view.dispatchEvent(
            new PointerEvent("pointermove", {
              bubbles: true,
              pointerId,
              clientX: startX + i * 2,
              clientY: startY - i * 3,
            }),
          );
          const at = await new Promise(requestAnimationFrame);
          samples.push({
            at,
            power: Number(view.style.getPropertyValue("--aim-power")),
          });
        }
        return samples;
      },
      { startX, startY },
    );
    expect(
      new Set(local.map((sample) => sample.power)).size,
    ).toBeGreaterThanOrEqual(30);
    expect(local.at(-1).power).toBeCloseTo(108 / 130, 3);
    await expect(phone.locator(".dice-power-text")).toHaveText("83% POWER");
    await expect
      .poll(
        () => previewPackets.filter((m) => m.type === "aim").at(-1)?.aim?.power,
      )
      .toBeCloseTo(108 / 130, 3);
    expect(previewPackets.filter((m) => m.type === "state")).toHaveLength(0);
    const aimPackets = previewPackets.filter((m) => m.type === "aim");
    expect(aimPackets.length).toBeLessThan(local.length);
    expect(
      aimPackets
        .slice(1)
        .every((m, i) => m.aim.at - aimPackets[i].aim.at >= 100),
    ).toBe(true);
    if (!process.env.CI || process.env.CRAPSTV_CAPTURE_AIM)
      await phone
        .locator(".dice-throw")
        .screenshot({ path: "artifacts/phone-aim-drag-375.png" });
    const remote = await tv.evaluate(() => {
      window.previewObserver.disconnect();
      return window.previewFrames;
    });
    await writeFile(
      "artifacts/throw-aim-samples.json",
      JSON.stringify({ local, remote, packets: aimPackets }, null, 2),
    );
    expect(new Set(remote.map((sample) => sample.aim[1])).size).toBeGreaterThan(
      2,
    );
    // TV renders intermediate power values without matching a fresh packet.
    expect(
      remote.some(({ aim: [, power] }) =>
        aimPackets.every((m) => Math.abs(m.aim.power - power) > 0.001),
      ),
    ).toBe(true);

    // A cancelled pointer clears both views and never launches the dice.
    await aimView.evaluate((view) =>
      view.dispatchEvent(
        new PointerEvent("pointercancel", {
          bubbles: true,
          pointerId: Number(view.dataset.testPointer),
        }),
      ),
    );
    await phone.mouse.up();
    await expect(tv.locator(".table-canvas")).toHaveAttribute("data-aim", "");
    await expect(aimView).toHaveAttribute("data-aiming", "false");
    expect(shooterThrows.filter((m) => m.type === "roll")).toHaveLength(0);
    previewPackets = null;

    // The release can arrive before the next network tick or local repaint.
    // Its coordinates determine the physical launch.
    await phone.mouse.move(startX, startY);
    await phone.mouse.down();
    await phone.mouse.move(startX + 55, startY - 104);
    await phone.mouse.up();
    await expect
      .poll(() => shooterThrows.filter((m) => m.type === "roll"))
      .toEqual([{ type: "roll", gesture: { x: 0.5, power: 0.8 } }]);
    await expect(phone.locator(".pg-strip.is-rolling")).toBeVisible();
    await expect(phone.getByTestId("phone-dice")).toHaveAttribute(
      "data-throw-id",
      /.+/,
    );
    const throwId = await phone
      .getByTestId("phone-dice")
      .getAttribute("data-throw-id");
    expect(throwId).toBeTruthy();
    await expect(aimView.locator(".dice-flight")).toHaveAttribute(
      "data-loaded",
      "true",
    );
    await expect(aimView.locator(".dice-flight canvas")).toBeVisible();
    await expect(tv.locator(".table-canvas")).toHaveAttribute(
      "data-throw-id",
      throwId,
    );
    await expect(tv.locator(".table-canvas")).toHaveAttribute(
      "data-cinematic",
      "true",
    );
    await expect(tv.locator(".table-canvas")).toHaveAttribute(
      "data-amount-labels-visible",
      "false",
    );
    await expect(phone.locator(".pg-strip.is-result")).toBeVisible();
    await expect(phone.locator(".pg-outcome .pg-die")).toHaveCount(2);
    // The phone can publish the result before a slow software-rendered TV
    // samples its final frame. Compare the actual settled TV pose, not a
    // still-moving frame from that authoritative throw.
    await expect(tv.locator(".table-canvas")).toHaveAttribute(
      "data-throw-settled",
      "true",
    );
    const landedPose = await tv
      .locator(".table-canvas")
      .getAttribute("data-pose");
    const shownFaces = await phone
      .locator(".pg-outcome .pg-die")
      .evaluateAll((nodes) =>
        nodes.map((node) =>
          Number(node.getAttribute("aria-label").match(/\d+/)[0]),
        ),
      );
    expect(
      JSON.parse(landedPose).map((die) => upperDieFace(die.quaternion).value),
    ).toEqual(shownFaces);
    // Regression: the resting orientation must not turn into a different result later.
    await phone.waitForTimeout(400);
    await expect(tv.locator(".table-canvas")).toHaveAttribute(
      "data-pose",
      landedPose,
    );
    await expect(
      phone.getByRole("tab", { name: "Play", exact: true }),
    ).toHaveAttribute("aria-selected", "true");
    await expect(phone.getByTestId("phone-dice")).toHaveCount(0);
    await capture(phone, {
      path: "artifacts/phone-dice-result.png",
      fullPage: true,
    });
    await capture(tv, { path: "artifacts/tv-playing.png", fullPage: true });
    // Reload must preserve identity and chips, rather than creating another seat.
    await phone.reload();
    await expect(phone.locator(".pg-identity b")).toHaveText("Tyler");
    await bob.bringToFront();
    await openAdminSection(bob, "Table");
    await bob.locator(".ha-management > summary").click();
    await bob.getByRole("button", { name: "Close table for everyone" }).click();
    await bob
      .getByRole("button", { name: "Close for everyone", exact: true })
      .click();
    await phone.getByText("YOUR NIGHT, RECAPPED").waitFor();
    await phone.bringToFront();
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
  } finally {
    await controllers.close();
  }
});
