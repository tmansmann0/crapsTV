// Retest during a real local aim/throw, on an isolated authority and browser.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium, expect } from "@playwright/test";
import { WebSocket } from "ws";
import { clickTV } from "./helpers/tv-actions.mjs";
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const listener = createServer();
await new Promise((r) => listener.listen(0, "127.0.0.1", r));
const port = listener.address().port;
await new Promise((r) => listener.close(r));
const server = spawn(process.execPath, ["server/index.js"], {
  env: {
    ...process.env,
    PORT: String(port),
    CRAPSTV_MDNS: "0",
    CRAPSTV_JOIN_MODE: "ip",
  },
  stdio: "ignore",
});
let browser, ws, state, page;
const errors = [];
const send = (message) => ws.send(JSON.stringify(message));
async function waitState(predicate) {
  for (let i = 0; i < 300; i++) {
    if (state && predicate(state)) return structuredClone(state);
    await pause(25);
  }
  throw Error("Authority state timed out");
}
try {
  let config;
  for (let i = 0; i < 100; i++) {
    try {
      config = await (
        await fetch(`http://127.0.0.1:${port}/api/config`)
      ).json();
      break;
    } catch {
      await pause(100);
    }
  }
  assert(config);
  ws = new WebSocket(`ws://127.0.0.1:${port}/socket`);
  ws.on("message", (raw) => {
    const m = JSON.parse(raw);
    if (m.type === "state") state = m.state;
    if (m.type === "error") errors.push(m.message);
  });
  await new Promise((resolve, reject) => {
    ws.once("open", resolve);
    ws.once("error", reject);
  });
  send({ type: "join", name: "Retest admin", code: config.code });
  await waitState((s) => s.players.length === 1);
  send({ type: "start", config: { rollCooldownSeconds: 0 } });
  await waitState((s) => s.status === "playing");
  browser = await chromium.launch({
    headless: true,
    args: [
      process.platform === "darwin" && !process.env.CI
        ? "--use-angle=metal"
        : "--use-angle=swiftshader",
      "--enable-webgl",
      "--ignore-gpu-blocklist",
    ],
  });
  page = await browser.newPage({
    viewport: process.env.CI
      ? { width: 800, height: 500 }
      : { width: 1280, height: 800 },
  });
  page.on("pageerror", (e) => errors.push(e.stack || e.message));
  await page.addInitScript(() => {
    window.retestFrames = [];
    const requestFrame = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (callback) =>
      requestFrame((at) => {
        callback(at);
        const d = document.querySelector(".table-canvas")?.dataset;
        if (!d?.startupQualityChanges) return;
        window.retestFrames.push({
          at,
          probe: Number(d.startupProbe),
          intro: d.graphicsIntro,
          rolling: d.startupRolling,
          done: d.startupDiceDone,
          hold: d.startupCalibrationHold,
          dice: JSON.parse(d.startupDicePose || "[]"),
          camera: JSON.parse(d.cameraPosition || "[]"),
          target: JSON.parse(d.cameraTarget || "[]"),
          fov: Number(d.cameraFov),
          quality: JSON.stringify([
            d.graphicsFps,
            d.graphicsTextures,
            d.graphicsModel,
            d.sceneResolution,
          ]),
          changes: JSON.parse(d.startupQualityChanges),
        });
      });
  });
  await page.goto(`http://127.0.0.1:${port}`);
  const table = page.locator(".table-canvas");
  await expect(table).toHaveAttribute("data-scene-ready", "true", {
    timeout: 60000,
  });
  await expect(table).toHaveAttribute("data-graphics-intro", "false");
  await clickTV(page, "settings");
  await clickTV(page, "graphics");
  send({ type: "aim", aim: { active: true, x: 0.2, power: 0.6 } });
  await waitState((s) => s.aim?.active);
  await clickTV(page, "graphics:retest");
  await expect(table).toHaveAttribute("data-startup-probe", "-1");
  await pause(450);
  assert.deepEqual(
    JSON.parse(await table.getAttribute("data-startup-quality-changes")),
    [],
    "aiming defers automatic quality changes",
  );
  send({ type: "roll", gesture: { x: 0.2, power: 0.6 } });
  await waitState((s) => s.rolling);
  await expect(table).toHaveAttribute("data-startup-rolling", "true");
  await pause(450);
  assert.deepEqual(
    JSON.parse(await table.getAttribute("data-startup-quality-changes")),
    [],
    "airborne dice defer automatic quality changes",
  );
  const settled = await waitState((s) => !s.rolling && !!s.lastRoll);
  await expect
    .poll(
      async () =>
        JSON.parse(await table.getAttribute("data-startup-quality-changes"))
          .length,
      { timeout: 15000 },
    )
    .toBeGreaterThan(0);
  await page.waitForFunction(
    () => {
      const first = window.retestFrames.find((f) => f.changes.length === 1);
      return first && window.retestFrames.some((f) => f.at >= first.at + 150);
    },
    null,
    { timeout: 15000 },
  );
  const frames = await page.evaluate(() => window.retestFrames);
  const airborne = frames.filter(
    (f) => f.intro === "true" && f.rolling === "true" && f.dice.length === 2,
  );
  assert(
    airborne.length >= 2,
    "actual flight is observed on multiple rendered frames",
  );
  const airborneSpanMs = airborne.at(-1).at - airborne[0].at;
  const airbornePoses = new Set(airborne.map((f) => JSON.stringify(f.dice)))
    .size;
  assert(airborneSpanMs >= 450, "observations span actual airborne time");
  assert(
    airbornePoses >= 2,
    "the real dice move between the flight observations",
  );
  assert(airborne.every((f) => f.probe === -1 && f.changes.length === 0));
  const changed = frames.find((f) => f.changes.length === 1);
  assert.equal(changed.probe, 0, "live candidates advance sequentially");
  assert.equal(changed.rolling, "false");
  assert.equal(changed.done, "true");
  assert.equal(changed.hold, "true");
  const before = frames.find(
    (f) =>
      f.hold === "true" &&
      f.rolling === "false" &&
      f.done === "true" &&
      f.changes.length === 0 &&
      f.at <= changed.at - 300,
  );
  const after = frames.find((f) => f.at >= changed.at + 150);
  assert(before && after);
  for (const key of ["dice", "camera", "target", "fov"]) {
    assert.deepEqual(before[key], changed[key]);
    assert.deepEqual(after[key], changed[key]);
  }
  await page.keyboard.press("Escape");
  await expect(table).toHaveAttribute("data-graphics-intro", "false");
  assert.deepEqual(state, settled, "Retest cannot touch the real ledger");
  assert.deepEqual(errors, []);
  await mkdir("artifacts", { recursive: true });
  await writeFile(
    "artifacts/startup-retest-qa.json",
    JSON.stringify(
      {
        ok: true,
        port,
        airborneFrames: airborne.length,
        airborneSpanMs,
        airbornePoses,
        changed,
        before,
        after,
        errors,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    "Retest proof passed: aim and real physics flight defer allocations; camera and dice rest 300ms before the sequential first probe.",
  );
} catch (error) {
  await mkdir("artifacts", { recursive: true });
  await writeFile(
    "artifacts/startup-retest-failure.json",
    JSON.stringify(
      {
        message: error.stack || error.message,
        frames: await page?.evaluate(() => window.retestFrames).catch(() => []),
        errors,
      },
      null,
      2,
    ),
  );
  throw error;
} finally {
  ws?.terminate();
  await browser?.close();
  server.kill("SIGTERM");
}
