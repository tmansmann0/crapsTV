// Retest during a real local aim/throw, on an isolated authority and browser.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium, expect } from "@playwright/test";
import { WebSocket } from "ws";
import { clickTV } from "./helpers/tv-actions.mjs";
import { sampleThrow } from "../src/throw-motion.js";
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const listener = createServer();
await new Promise((r) => listener.listen(0, "127.0.0.1", r));
const port = listener.address().port;
await new Promise((r) => listener.close(r));
const server = spawn(
  process.execPath,
  ["tests/helpers/live-retest-server.mjs"],
  {
    env: {
      ...process.env,
      PORT: String(port),
      CRAPSTV_MDNS: "0",
      CRAPSTV_JOIN_MODE: "ip",
    },
    stdio: ["ignore", "pipe", "pipe"],
  },
);
let serverLog = "";
server.stdout.on("data", (chunk) => {
  serverLog += chunk;
});
server.stderr.on("data", (chunk) => {
  serverLog += chunk;
});
server.on("exit", (code, signal) => {
  serverLog += `\nAuthority process exited: code=${code} signal=${signal}\n`;
});
let browser, ws, state, page, authorityFlight;
const authorityTimings = new Map();
const errors = [];
const send = (message) => ws.send(JSON.stringify(message));
async function waitState(predicate) {
  const deadline = performance.now() + 15000;
  while (performance.now() < deadline) {
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
  assert.deepEqual(config.testAuthority, {
    implementation: "RoomHub",
    throwDurationMs: 8000,
  });
  ws = new WebSocket(`ws://127.0.0.1:${port}/socket`);
  ws.on("message", (raw) => {
    const m = JSON.parse(raw);
    if (m.type === "state") {
      state = m.state;
      const id = state.throw?.id;
      if (id && state.rolling && !authorityTimings.has(id))
        authorityTimings.set(id, { rollingAt: performance.now() });
      if (id && !state.rolling && authorityTimings.has(id))
        authorityTimings.get(id).settledAt ??= performance.now();
    }
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
  page.on("crash", () => errors.push("Browser renderer crashed"));
  page.on("console", (message) => {
    if (
      message.type() === "error" ||
      /GL_INVALID|INVALID_OPERATION/.test(message.text())
    )
      errors.push(message.text());
  });
  await page.addInitScript(() => {
    window.retestFrames = [];
    let previousWorldFrame;
    const requestFrame = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (callback) =>
      requestFrame((at) => {
        callback(at);
        const d = document.querySelector(".table-canvas")?.dataset;
        if (!d?.startupQualityChanges) return;
        const worldFrame = Number(d.worldFrame);
        if (
          !Number.isInteger(worldFrame) ||
          worldFrame < 1 ||
          worldFrame === previousWorldFrame
        )
          return;
        previousWorldFrame = worldFrame;
        const frame = {
          at,
          worldFrame,
          elapsed: Number(d.startupElapsed),
          throwId: d.throwId,
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
        };
        // The renderer increments worldFrame only after the complete actual
        // draw. Keep genuine identical static frames, omit stale throttled RAFs.
        window.retestFrames.push(frame);
      });
  });
  await page.goto(`http://127.0.0.1:${port}`);
  const table = page.locator(".table-canvas");
  await expect(table).toHaveAttribute("data-scene-ready", "true", {
    timeout: 60000,
  });
  await expect(table).toHaveAttribute("data-graphics-intro", "false");
  await expect(table).toHaveAttribute("data-world-frame", /^\d+$/);
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
  authorityFlight = (await waitState((s) => s.rolling)).throw;
  assert.equal(authorityFlight.duration, 8000);
  assert.equal(authorityFlight.frames.at(-1)[0], 8000);
  assert.equal(authorityFlight.settledAt - authorityFlight.startAt, 7040);
  assert(
    authorityFlight.physicsSteps >= 120 && authorityFlight.frames.length >= 61,
  );
  assert.equal(
    authorityFlight.simulationDuration,
    authorityFlight.physicsSteps / 120,
  );
  await expect(table).toHaveAttribute("data-startup-rolling", "true");
  await pause(450);
  assert.deepEqual(
    JSON.parse(await table.getAttribute("data-startup-quality-changes")),
    [],
    "airborne dice defer automatic quality changes",
  );
  const settled = await waitState((s) => !s.rolling && !!s.lastRoll);
  const authorityTiming = authorityTimings.get(authorityFlight.id);
  assert(
    authorityTiming.settledAt - authorityTiming.rollingAt >= 7750,
    "the real RoomHub holds its actual eight-second flight; browser timestamps are not slowed or forged",
  );
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
    (f) =>
      f.intro === "true" &&
      f.rolling === "true" &&
      f.done === "false" &&
      f.throwId === authorityFlight.id &&
      f.dice.length === 2,
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
  // Match each observed interpolation to a segment of the authority's actual
  // Cannon trajectory, independently of when the browser managed to render it.
  for (const observation of airborne) {
    const position = observation.dice.flatMap((die) => die.position);
    const matched = authorityFlight.frames.slice(0, -1).some((first, index) => {
      const second = authorityFlight.frames[index + 1];
      const a = [...first.slice(1, 4), ...first.slice(8, 11)];
      const b = [...second.slice(1, 4), ...second.slice(8, 11)];
      const delta = b.map((n, i) => n - a[i]);
      const length = delta.reduce((sum, n) => sum + n * n, 0);
      const t =
        length > 1e-16
          ? position.reduce((sum, n, i) => sum + (n - a[i]) * delta[i], 0) /
            length
          : 0;
      if (
        t < -1e-6 ||
        t > 1 + 1e-6 ||
        position.some((n, i) => Math.abs(n - a[i] - delta[i] * t) > 1e-6)
      )
        return false;
      const expected = sampleThrow(
        authorityFlight,
        authorityFlight.startAt + first[0] + (second[0] - first[0]) * t,
      );
      return expected.dice.every((die, i) =>
        die.quaternion.every(
          (n, j) => Math.abs(n - observation.dice[i].quaternion[j]) < 1e-5,
        ),
      );
    });
    assert(
      matched,
      "rendered in-flight poses belong to the actual recorded Cannon motion",
    );
  }
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
        authorityDurationMs: authorityFlight.duration,
        authorityObservedMs:
          authorityTiming.settledAt - authorityTiming.rollingAt,
        physicalObservationsMatched: airborne.length,
        changed,
        before,
        after,
        errors,
        authorityFlight,
        authorityTimings: [...authorityTimings],
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
        authorityFlight,
        authorityTimings: [...authorityTimings],
        serverLog,
        browserState: await page
          ?.evaluate(() => ({
            hidden: document.hidden,
            dataset: { ...document.querySelector(".table-canvas")?.dataset },
            contextLost: document
              .querySelector(".table-canvas canvas")
              ?.getContext("webgl2")
              ?.isContextLost(),
          }))
          .catch(() => null),
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
