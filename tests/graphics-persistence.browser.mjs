// A completed real opening, a reload at fixed saved quality, and explicit Retest.
import express from "express";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { WebSocket, WebSocketServer } from "ws";
import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";
import { access, mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { serveBuiltApp } from "../server/static-app.js";
import { RoomHub } from "../src/hub.js";
import { GRAPHICS_CALIBRATION_STORAGE } from "../src/graphics-calibration-store.js";
import { clickTV } from "./helpers/tv-actions.mjs";
const code = "SAVEQA",
  hub = new RoomHub(code),
  app = express(),
  server = createServer(app),
  sockets = new WebSocketServer({ server, path: "/socket" });
let origin,
  browser,
  socket,
  page,
  phase = "fixture";
const startedAt = Date.now();
function checkpoint(next) {
  phase = next;
  console.log(
    `[persistence +${((Date.now() - startedAt) / 1000).toFixed(1)}s] ${phase}`,
  );
}
app.get("/api/config", (_req, res) =>
  res.json({ local: true, code, joinOrigin: origin, lanOrigin: origin }),
);
sockets.on("connection", (ws) => {
  const id = randomUUID();
  hub.connect(id, (message) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
  });
  ws.on("message", (raw) => hub.receive(id, JSON.parse(raw)));
  ws.on("close", () => hub.disconnect(id));
});
const errors = [];
const browserLog = [];
try {
  const root = fileURLToPath(new URL("../", import.meta.url));
  await access(new URL("../dist/index.html", import.meta.url));
  // Exercise the installed app, as the other startup tests do. CI builds dist
  // before browser tests; no development optimizer is needed during reloads.
  serveBuiltApp(app, root);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({
    headless: true,
    args: [
      `--use-angle=${process.platform === "darwin" && !process.env.CI ? "metal" : "swiftshader"}`,
      "--ignore-gpu-blocklist",
      "--enable-webgl",
    ],
  });
  const viewport = process.env.CI
    ? { width: 960, height: 600 }
    : { width: 1280, height: 800 };
  page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("crash", () => errors.push("Browser renderer crashed"));
  page.on("requestfailed", (request) => {
    browserLog.push({ url: request.url(), failure: request.failure() });
  });
  page.on("console", (message) => {
    if (message.type() === "error") browserLog.push(message.text());
    if (/GL_INVALID|INVALID_OPERATION/.test(message.text()))
      errors.push(message.text());
  });
  await page.addInitScript(() => {
    if (!localStorage.getItem("crapstv-graphics-v1"))
      localStorage.setItem(
        "crapstv-graphics-v1",
        JSON.stringify({
          lensFlares: "off",
          localReflections: "off",
          contactShadows: "off",
        }),
      );
    window.persistenceFrames = [];
    let lastFrame;
    function sample() {
      const data = document.querySelector(".table-canvas")?.dataset;
      if (data?.sceneReady === "true" && data.worldFrame !== lastFrame) {
        lastFrame = data.worldFrame;
        window.persistenceFrames.push({
          frame: data.worldFrame,
          elapsed: Number(data.startupElapsed),
          active: data.graphicsIntro,
          source: data.graphicsProfileSource,
          calibrating: data.graphicsCalibrating,
          quality: data.graphicsProfile,
          scene: data.sceneResolution,
          fps: Number(data.graphicsFps),
          textures: Number(data.graphicsTextures),
          model: data.graphicsModel,
          changes: JSON.parse(data.startupQualityChanges || "[]").length,
        });
      }
      requestAnimationFrame(sample);
    }
    requestAnimationFrame(sample);
  });
  const table = page.locator(".table-canvas");
  const cache = () =>
    page.evaluate(
      (key) => JSON.parse(localStorage.getItem(key) || "null"),
      GRAPHICS_CALIBRATION_STORAGE,
    );
  // Navigation only needs a new document. The explicit scene-ready assertions
  // below are the application's readiness gate; waiting for the browser load
  // event also waits behind software-GL startup work on the CI renderer.
  const navigation = { waitUntil: "commit" };
  checkpoint("first calibration");
  await page.goto(origin, navigation);
  await expect(table).toHaveAttribute("data-scene-ready", "true", {
    timeout: 90000,
  });
  await expect(table).toHaveAttribute("data-graphics-intro", "false", {
    timeout: 120000,
  });
  const first = await cache();
  assert(first?.profile, "Completed first calibration is stored");
  assert.equal(
    await table.getAttribute("data-graphics-profile-source"),
    "measured",
  );
  const beforePrefs = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("crapstv-graphics-v1")),
  );
  checkpoint("saved opening");
  await page.reload(navigation);
  await expect(table).toHaveAttribute("data-scene-ready", "true", {
    timeout: 90000,
  });
  await expect(table).toHaveAttribute("data-graphics-profile-source", "saved");
  await expect(table).toHaveAttribute("data-graphics-calibrating", "false");
  await expect(table).toHaveAttribute("data-graphics-intro", "false", {
    timeout: 120000,
  });
  const reloaded = await page.evaluate(() => window.persistenceFrames);
  const intro = reloaded.filter((frame) => frame.active === "true");
  assert(intro.length > 20);
  assert(
    intro.some((frame) => frame.elapsed >= 29000),
    "Saved settings keep the full cinematic opening",
  );
  assert(
    intro.every(
      (frame) =>
        frame.source === "saved" &&
        frame.calibrating === "false" &&
        frame.changes === 0,
    ),
  );
  for (const key of ["quality", "scene", "fps", "textures", "model"])
    assert.equal(
      new Set(intro.map((frame) => frame[key])).size,
      1,
      `${key} stays fixed through the reloaded opening`,
    );
  assert.deepEqual((await cache()).profile, first.profile);
  assert.deepEqual(
    await page.evaluate(() =>
      JSON.parse(localStorage.getItem("crapstv-graphics-v1")),
    ),
    beforePrefs,
  );
  const manual = {
    ...beforePrefs,
    fps: 30,
    resolution: "75",
    antialias: "on",
    textures: "1k",
    modelDetail: "optimized",
  };
  await page.evaluate(
    (prefs) =>
      localStorage.setItem("crapstv-graphics-v1", JSON.stringify(prefs)),
    manual,
  );
  checkpoint("manual choices");
  await page.reload(navigation);
  await expect(table).toHaveAttribute("data-scene-ready", "true", {
    timeout: 90000,
  });
  await expect(table).toHaveAttribute("data-graphics-profile-source", "saved");
  await expect(table).toHaveAttribute("data-graphics-fps", "30");
  await expect(table).toHaveAttribute("data-graphics-textures", "1024");
  await expect(table).toHaveAttribute("data-graphics-model", "optimized");
  await page.keyboard.press("Escape");
  await expect(table).toHaveAttribute("data-graphics-intro", "false");
  // Start only this private room through its ordinary wire actions. A live-game
  // reload must retain the cache as well, without playing another demo.
  socket = new WebSocket(`${origin.replace("http", "ws")}/socket`);
  let playing;
  socket.on("message", (raw) => {
    const m = JSON.parse(raw);
    if (m.type === "welcome") socket.send(JSON.stringify({ type: "start" }));
    if (m.type === "state" && m.state.status === "playing") playing = m.state;
  });
  await new Promise((resolve) =>
    socket.once("open", () => {
      socket.send(
        JSON.stringify({ type: "join", code, name: "Persistence QA" }),
      );
      resolve();
    }),
  );
  await expect.poll(() => !!playing).toBe(true);
  checkpoint("live room reload");
  await page.reload(navigation);
  await expect(table).toHaveAttribute("data-scene-ready", "true", {
    timeout: 90000,
  });
  await expect(table).toHaveAttribute("data-graphics-intro", "false");
  await expect(table).toHaveAttribute("data-demo-active", "false");
  await expect(table).toHaveAttribute("data-graphics-profile-source", "saved");
  await expect
    .poll(async () =>
      Number(await table.getAttribute("data-startup-ui-opacity")),
    )
    .toBe(1);
  checkpoint("explicit Retest");
  await clickTV(page, "settings");
  await clickTV(page, "graphics");
  await clickTV(page, "graphics:retest");
  await expect(table).toHaveAttribute("data-graphics-calibrating", "true");
  await expect(table).toHaveAttribute("data-graphics-intro", "false", {
    timeout: 120000,
  });
  const retested = await cache();
  assert(
    retested.savedAt > first.savedAt,
    "A successful explicit Retest refreshes the saved result",
  );
  assert.deepEqual(
    await page.evaluate(() =>
      JSON.parse(localStorage.getItem("crapstv-graphics-v1")),
    ),
    manual,
  );
  checkpoint("kiosk navigation");
  await page.goto(`${origin}/?kiosk=1`, navigation);
  await expect(table).toHaveAttribute("data-scene-ready", "true", {
    timeout: 90000,
  });
  await page.keyboard.press("Escape");
  await expect
    .poll(async () =>
      Number(await table.getAttribute("data-startup-ui-opacity")),
    )
    .toBe(1);
  assert.equal(
    await page.getByRole("button", { name: /settings/i }).count(),
    0,
  );
  const kioskUI = JSON.parse(await table.getAttribute("data-ui-actions"));
  const kioskText = JSON.parse(
    await table.getAttribute("data-ui-text-metrics"),
  );
  assert.equal(kioskUI.settings, undefined);
  assert.equal(kioskText.settingsButton.visible, false);
  assert.equal(kioskText.join.visible, true);
  assert(
    kioskText.join.address.address.includes(new URL(origin).host),
    "Kiosk keeps the join address visible",
  );
  assert.deepEqual(errors, []);
  await mkdir("artifacts/graphics-persistence", { recursive: true });
  const report = {
    first: first.profile,
    reloadedIntroFrames: intro.length,
    reloadedQualityVariants: Object.fromEntries(
      ["quality", "scene", "fps", "textures", "model"].map((key) => [
        key,
        new Set(intro.map((frame) => frame[key])).size,
      ]),
    ),
    manualChoicesPreserved: true,
    playingRoomSkipsDemo: true,
    kioskHidesOnlyTVSettings: true,
    retestUpdatedSavedAt: retested.savedAt,
    errors,
  };
  await writeFile(
    "artifacts/graphics-persistence/report.json",
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report));
  checkpoint("passed");
} catch (error) {
  // Keep the actual application state with timeout failures in CI artifacts.
  // A wedged renderer must not prevent the original failure from surfacing.
  let timer;
  const state = await Promise.race([
    page
      ?.evaluate(() => ({
        url: location.href,
        visibility: document.visibilityState,
        table: { ...document.querySelector(".table-canvas")?.dataset },
        lastFrames: window.persistenceFrames?.slice(-5),
      }))
      .catch((failure) => ({ diagnosticError: failure.message })),
    new Promise((resolve) => {
      timer = setTimeout(
        () => resolve({ diagnosticError: "Renderer did not answer in 5s" }),
        5000,
      );
    }),
  ]);
  clearTimeout(timer);
  const failure = {
    phase,
    elapsedMs: Date.now() - startedAt,
    error: error.stack,
    errors,
    browserLog,
    state,
  };
  await mkdir("artifacts/graphics-persistence", { recursive: true });
  await writeFile(
    "artifacts/graphics-persistence/failure.json",
    JSON.stringify(failure, null, 2),
  );
  console.error(JSON.stringify(failure));
  throw error;
} finally {
  hub.close();
  socket?.terminate();
  await browser?.close();
  for (const ws of sockets.clients) ws.terminate();
  await new Promise((resolve) => sockets.close(resolve));
  await new Promise((resolve) => server.close(resolve));
}
