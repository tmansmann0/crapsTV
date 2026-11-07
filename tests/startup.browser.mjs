// Real-clock startup proof in a private lobby; never connects to a user room.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdir, writeFile } from "node:fs/promises";
import { inflateSync } from "node:zlib";
import { chromium, expect } from "@playwright/test";
import { WebSocket } from "ws";
import { clickTV } from "./helpers/tv-actions.mjs";

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const listener = createServer();
await new Promise((resolve) => listener.listen(0, "127.0.0.1", resolve));
const port = listener.address().port;
await new Promise((resolve) => listener.close(resolve));
const origin = `http://127.0.0.1:${port}`;
const server = spawn(
  process.execPath,
  ["server/index.js", ...(process.env.STARTUP_TEST_DEV ? ["--dev"] : [])],
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
for (const stream of [server.stdout, server.stderr])
  stream.on("data", (chunk) => {
    serverLog += chunk;
  });
let browser,
  page,
  socket,
  latestState,
  config,
  releaseAsset,
  releaseWear,
  releaseScratch;
const extraAssetGates = [];
const errors = [],
  glErrors = [],
  samples = [];

// Decode the browser's ordinary non-interlaced RGB/RGBA PNG without another
// image dependency. Checking pixels proves a black asset gate, not just a flag.
function darkFraction(png) {
  const chunks = [];
  let width, height, channels;
  for (let at = 8; at < png.length;) {
    const size = png.readUInt32BE(at),
      type = png.toString("ascii", at + 4, at + 8);
    const data = png.subarray(at + 8, at + 8 + size);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      assert.equal(data[8], 8);
      assert.equal(data[12], 0);
      channels = data[9] === 6 ? 4 : data[9] === 2 ? 3 : 0;
      assert(channels, "PNG screenshot must be RGB or RGBA");
    }
    if (type === "IDAT") chunks.push(data);
    at += size + 12;
  }
  const raw = inflateSync(Buffer.concat(chunks)),
    stride = width * channels;
  let previous = Buffer.alloc(stride),
    offset = 0,
    dark = 0;
  const paeth = (a, b, c) => {
    const p = a + b - c,
      da = Math.abs(p - a),
      db = Math.abs(p - b),
      dc = Math.abs(p - c);
    return da <= db && da <= dc ? a : db <= dc ? b : c;
  };
  for (let y = 0; y < height; y++) {
    const filter = raw[offset++],
      row = Buffer.alloc(stride);
    assert(filter <= 4);
    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? row[x - channels] : 0;
      const above = previous[x],
        diagonal = x >= channels ? previous[x - channels] : 0;
      row[x] =
        (raw[offset++] +
          [
            0,
            left,
            above,
            Math.floor((left + above) / 2),
            paeth(left, above, diagonal),
          ][filter]) &
        255;
    }
    for (let x = 0; x < stride; x += channels)
      if (Math.max(row[x], row[x + 1], row[x + 2]) <= 8) dark++;
    previous = row;
  }
  return dark / (width * height);
}

async function waitState(predicate, timeout = 5000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    if (latestState && predicate(latestState))
      return structuredClone(latestState);
    await pause(25);
  }
  throw Error("Timed out waiting for private room state");
}
try {
  for (let attempt = 0; attempt < 200; attempt++) {
    assert.equal(server.exitCode, null, `Private server exited: ${serverLog}`);
    try {
      config = await (await fetch(`${origin}/api/config`)).json();
      break;
    } catch {
      await pause(100);
    }
  }
  assert(config, serverLog);
  socket = new WebSocket(`ws://127.0.0.1:${port}/socket`);
  socket.on("message", (raw) => {
    const message = JSON.parse(raw);
    if (message.type === "state") latestState = message.state;
    if (message.type === "error") errors.push(`authority: ${message.message}`);
  });
  await new Promise((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  const untouchedLobby = await waitState((s) => s.status === "lobby");
  assert.equal(untouchedLobby.players.length, 0);
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
    deviceScaleFactor: 1,
  });
  const capture = async (name) => {
    if (!process.env.CI || process.env.STARTUP_CAPTURE === "1")
      await page.screenshot({ path: `artifacts/startup-${name}.png` });
  };
  page.on("pageerror", (error) => errors.push(error.stack || error.message));
  page.on("console", (message) => {
    if (
      /GL_INVALID|INVALID_OPERATION|INVALID_VALUE|texSubImage.*error/i.test(
        message.text(),
      )
    )
      glErrors.push(message.text());
  });
  await page.addInitScript(() => {
    window.startupSamples = [];
    const requestFrame = window.requestAnimationFrame.bind(window);
    let lastSample;
    // Read immediately after the app's RAF callback and retain the SAME RAF
    // timestamp it received. A separate timer can read a previous frame's DOM
    // after a slow software draw, producing a false shortened-opening result.
    window.requestAnimationFrame = (callback) =>
      requestFrame((at) => {
        callback(at);
        const d = document.querySelector(".table-canvas")?.dataset;
        if (!d?.startupPhase) return;
        const key = [d.startupPhase, d.startupElapsed, d.graphicsIntro].join(
          ":",
        );
        if (key === lastSample) return;
        lastSample = key;
        window.startupSamples.push({
          at,
          observedAt: performance.now(),
          phase: d.startupPhase,
          elapsed: Number(d.startupElapsed),
          fade: Number(d.startupFade),
          ui: Number(d.startupUiOpacity),
          ready: d.sceneReady,
          demo: d.demoActive,
          intro: d.graphicsIntro,
          throwId: d.throwId,
          transfers: JSON.parse(d.activeTransfers || "[]"),
          probe: Number(d.startupProbe),
          fps: Number(d.graphicsFps),
          textureLimit: Number(d.graphicsTextures),
          modelDetail: d.graphicsModel,
          sceneResolution: d.sceneResolution,
          hold: d.startupCalibrationHold,
          rolling: d.startupRolling,
          diceDone: d.startupDiceDone,
          dicePose: JSON.parse(d.startupDicePose || "[]"),
          effectiveFps: Number(d.startupEffectiveFps),
          uploadPausedMs: Number(d.startupUploadPausedMs || 0),
          qualityChanges: JSON.parse(d.startupQualityChanges || "[]"),
          cameraPosition: JSON.parse(d.cameraPosition || "[]"),
          cameraTarget: JSON.parse(d.cameraTarget || "[]"),
          cameraFov: Number(d.cameraFov),
        });
      });
  });
  let sawAsset;
  const assetHeld = new Promise((resolve) => {
    releaseAsset = resolve;
  });
  const assetRequested = new Promise((resolve) => {
    sawAsset = resolve;
  });
  let delayed = false;
  await page.route("**/wood-studies/american/albedo.jpg*", async (route) => {
    if (!delayed) {
      delayed = true;
      sawAsset();
      await assetHeld;
    }
    await route.continue();
  });
  let sawWear;
  const wearHeld = new Promise((resolve) => {
    releaseWear = resolve;
  });
  const wearRequested = new Promise((resolve) => {
    sawWear = resolve;
  });
  let delayedWear = false;
  await page.route("**/*dice-wear-1.png*", async (route) => {
    if (!delayedWear) {
      delayedWear = true;
      sawWear();
      await wearHeld;
    }
    await route.continue();
  });
  let sawScratch;
  const scratchHeld = new Promise((resolve) => {
    releaseScratch = resolve;
  });
  const scratchRequested = new Promise((resolve) => {
    sawScratch = resolve;
  });
  let delayedScratch = false;
  await page.route("**/*chip-scratch-study.png*", async (route) => {
    if (!delayedScratch) {
      delayedScratch = true;
      sawScratch();
      await scratchHeld;
    }
    await route.continue();
  });
  for (const [name, pattern] of [
    ["felt", "**/felt-studies/wool-fibres.png*"],
    ["vector", "**/board-classic-vector.bin*"],
  ]) {
    let release, requested;
    const held = new Promise((resolve) => (release = resolve));
    const seen = new Promise((resolve) => (requested = resolve));
    extraAssetGates.push({ name, release, seen });
    await page.route(pattern, async (route) => {
      requested();
      await held;
      await route.continue();
    });
  }
  await page.goto(origin);
  const table = page.locator(".table-canvas");
  await Promise.race([
    Promise.all([
      assetRequested,
      wearRequested,
      scratchRequested,
      ...extraAssetGates.map((gate) => gate.seen),
    ]),
    pause(45000).then(() => {
      throw Error(
        "Expected critical wood, dice, chip scratch, wool atlas and vector board requests",
      );
    }),
  ]);
  await expect(table).toHaveAttribute("data-startup-phase", "loading");
  await pause(1800);
  await expect(table).toHaveAttribute("data-scene-ready", "false");
  assert.equal(
    Number(await table.getAttribute("data-startup-elapsed")),
    0,
    "30-second clock must not spend time loading assets",
  );
  assert.equal(Number(await table.getAttribute("data-startup-ui-opacity")), 0);
  await mkdir("artifacts", { recursive: true });
  const black = await table.screenshot({
    path: "artifacts/startup-asset-gate.png",
    animations: "allow",
  });
  const blackPixels = darkFraction(black);
  assert(blackPixels > 0.995, `asset gate must be black (${blackPixels})`);
  releaseAsset();
  // The table may be ready while a small dice data-map is still in flight.
  // That remaining asset must keep the same black gate and untouched clock.
  await pause(650);
  await expect(table).toHaveAttribute("data-startup-phase", "loading");
  await expect(table).toHaveAttribute("data-scene-ready", "false");
  assert.equal(Number(await table.getAttribute("data-startup-elapsed")), 0);
  assert.equal(Number(await table.getAttribute("data-startup-fade")), 0);
  assert.equal(Number(await table.getAttribute("data-startup-ui-opacity")), 0);
  const wearBlackPixels = darkFraction(
    await table.screenshot({
      path: "artifacts/startup-dice-asset-gate.png",
      animations: "allow",
    }),
  );
  assert(
    wearBlackPixels > 0.995,
    `remaining dice texture must retain black gate (${wearBlackPixels})`,
  );
  releaseWear();
  // The new production scratch sampler is also a critical asset. Even with
  // the table and dice ready, no partial unscuffed scene may fade in.
  await pause(650);
  await expect(table).toHaveAttribute("data-startup-phase", "loading");
  await expect(table).toHaveAttribute("data-scene-ready", "false");
  assert.equal(Number(await table.getAttribute("data-startup-elapsed")), 0);
  assert.equal(Number(await table.getAttribute("data-startup-fade")), 0);
  assert.equal(Number(await table.getAttribute("data-startup-ui-opacity")), 0);
  const scratchBlackPixels = darkFraction(
    await table.screenshot({
      path: "artifacts/startup-scratch-asset-gate.png",
      animations: "allow",
    }),
  );
  assert(
    scratchBlackPixels > 0.995,
    `selected chip scratch sampler must retain black gate (${scratchBlackPixels})`,
  );
  releaseScratch();
  for (const gate of extraAssetGates) {
    await pause(650);
    await expect(table).toHaveAttribute("data-scene-ready", "false");
    assert.equal(Number(await table.getAttribute("data-startup-elapsed")), 0);
    assert.equal(Number(await table.getAttribute("data-startup-fade")), 0);
    assert.equal(
      Number(await table.getAttribute("data-startup-ui-opacity")),
      0,
    );
    const fraction = darkFraction(
      await table.screenshot({
        path: `artifacts/startup-${gate.name}-asset-gate.png`,
        animations: "allow",
      }),
    );
    assert(
      fraction > 0.995,
      `${gate.name} must retain black gate (${fraction})`,
    );
    gate.release();
  }
  const releasedAt = Date.now();
  await expect(table).toHaveAttribute("data-scene-ready", "true", {
    timeout: 60000,
  });
  await expect(table).toHaveAttribute("data-demo-active", "true");
  await expect
    .poll(async () => Number(await table.getAttribute("data-startup-fade")), {
      timeout: 5000,
    })
    .toBeGreaterThan(0.99);
  await capture("materials");
  await expect(table).toHaveAttribute("data-startup-phase", "dice", {
    timeout: 12000,
  });
  await capture("dice");
  await expect(table).toHaveAttribute("data-startup-phase", "payout", {
    timeout: 45000,
  });
  await expect
    .poll(
      async () =>
        JSON.parse((await table.getAttribute("data-active-transfers")) || "[]")
          .length,
    )
    .toBeGreaterThan(0);
  await capture("payout");
  await expect(table).toHaveAttribute("data-startup-phase", "live", {
    timeout: 90000,
  });
  await expect(table).toHaveAttribute("data-graphics-intro", "false");
  await expect(table).toHaveAttribute("data-demo-active", "false");
  assert.equal(Number(await table.getAttribute("data-startup-ui-opacity")), 1);
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.startupSamples.some(
          (s) => s.phase === "live" && s.intro === "false",
        ),
      ),
    )
    .toBe(true);
  samples.push(...(await page.evaluate(() => window.startupSamples)));
  const started = samples.find((s) => s.ready === "true" && s.demo === "true");
  const ended = samples.find((s) => s.phase === "live" && s.intro === "false");
  assert(started && ended);
  // The first telemetry interval can arrive several frames into the fade.
  // Recover its clock origin instead of discarding those elapsed milliseconds.
  const actualDuration = ended.at - started.at + started.elapsed;
  const uploadPausedMs = ended.uploadPausedMs;
  const contentDuration = actualDuration - uploadPausedMs;
  assert(
    contentDuration >= 29900 && contentDuration < 31000,
    `opening content ran ${contentDuration}ms (${actualDuration}ms wall, ${uploadPausedMs}ms accounted resource waits) instead of30s`,
  );
  assert.equal(
    ended.elapsed,
    30000,
    "the entire 30s demonstration must play, including every payout",
  );
  assert(Date.now() - releasedAt >= 29500);
  for (const phase of [
    "loading",
    "materials",
    "table",
    "dice",
    "payout",
    "live",
  ])
    assert(
      samples.some((s) => s.phase === phase),
      `missing ${phase}`,
    );
  assert.equal(
    new Set(samples.filter((s) => s.phase === "dice").map((s) => s.throwId))
      .size,
    2,
    "opening includes two distinct physical throws",
  );
  assert(samples.some((s) => s.transfers.some((flow) => flow.kind === "win")));
  assert(samples.some((s) => s.transfers.some((flow) => flow.kind === "loss")));
  assert(
    samples
      .filter((s) => s.demo === "true" && s.elapsed < 28200)
      .every((s) => s.ui === 0),
    "ordinary TV UI stays hidden during showcase",
  );
  assert(
    samples.some((s) => s.elapsed > 28200 && s.ui > 0 && s.ui < 1),
    "UI fades in during final1.8s",
  );
  const qualityChanges = ended.qualityChanges;
  assert.deepEqual(
    qualityChanges.map((change) => change.probe),
    [1, 2, 3],
  );
  const qualityKey = (sample) =>
    JSON.stringify([
      sample.effectiveFps,
      sample.textureLimit,
      sample.modelDetail,
      sample.sceneResolution,
    ]);
  const demoSamples = samples.filter((sample) => sample.demo === "true");
  const actualChanges = demoSamples.filter(
    (sample, index) =>
      index > 0 && qualityKey(sample) !== qualityKey(demoSamples[index - 1]),
  );
  for (const change of qualityChanges) {
    const changed = demoSamples.find(
      (sample) =>
        sample.probe === change.probe &&
        sample.qualityChanges.length === change.probe,
    );
    assert(changed, `missing actual render frame for probe ${change.probe}`);
    assert.equal(changed.hold, "true");
    assert.equal(changed.rolling, "false");
    assert.equal(changed.diceDone, "true");
    assert.equal(
      changed.transfers.length,
      0,
      "resource upload happens before or after chip animations",
    );
    const before = demoSamples
      .filter(
        (sample) => sample.at < changed.at && sample.at >= changed.at - 250,
      )
      .at(0);
    const after = demoSamples.find((sample) => sample.at >= changed.at + 150);
    assert(
      before && after,
      "static result has enough visible camera lead and recovery",
    );
    assert.deepEqual(before.dicePose, changed.dicePose);
    assert.deepEqual(after.dicePose, changed.dicePose);
    assert.deepEqual(before.cameraPosition, changed.cameraPosition);
    assert.deepEqual(after.cameraPosition, changed.cameraPosition);
    assert.deepEqual(before.cameraTarget, changed.cameraTarget);
    assert.deepEqual(after.cameraTarget, changed.cameraTarget);
    assert.equal(before.cameraFov, changed.cameraFov);
    assert.equal(after.cameraFov, changed.cameraFov);
    assert(change.holdAge >= 300);
  }
  for (const sample of actualChanges) {
    assert.equal(
      sample.hold,
      "true",
      "actual graphics allocations change only inside static holds",
    );
    assert.equal(sample.rolling, "false");
    assert.equal(sample.diceDone, "true");
  }
  assert.equal(
    qualityKey(ended),
    qualityKey(demoSamples.at(-1)),
    "30s end does not trigger another quality resize/upload/FPS switch",
  );
  assert.deepEqual(
    latestState,
    untouchedLobby,
    "opening cannot join players, wager or change the actual lobby",
  );
  await capture("live");

  // Escape skips only the local introduction, never a room action.
  await page.reload();
  await expect(table).toHaveAttribute("data-demo-active", "true", {
    timeout: 60000,
  });
  await page.keyboard.press("Escape");
  await expect(table).toHaveAttribute("data-graphics-intro", "false", {
    timeout: 5000,
  });
  await expect(table).toHaveAttribute("data-demo-active", "false");
  assert.deepEqual(latestState, untouchedLobby);

  // A real game already in progress must be shown instead of a fake opening.
  socket.send(
    JSON.stringify({
      type: "join",
      name: "Startup test admin",
      code: config.code,
    }),
  );
  await waitState((s) => s.players.length === 1);
  socket.send(JSON.stringify({ type: "start" }));
  const playing = await waitState((s) => s.status === "playing");
  await page.reload();
  await expect(table).toHaveAttribute("data-scene-ready", "true", {
    timeout: 60000,
  });
  await expect(table).toHaveAttribute("data-startup-phase", "live", {
    timeout: 5000,
  });
  await expect(table).toHaveAttribute("data-demo-active", "false");
  assert(
    !(await page.evaluate(() => window.startupSamples)).some(
      (s) => s.demo === "true",
    ),
  );
  assert.deepEqual(latestState, playing);

  // Retesting during a live game measures the real scene, with usable TV UI.
  await expect
    .poll(async () =>
      Number(await table.getAttribute("data-startup-ui-opacity")),
    )
    .toBe(1);
  await clickTV(page, "settings");
  await clickTV(page, "graphics");
  await clickTV(page, "graphics:retest");
  await expect(table).toHaveAttribute("data-graphics-intro", "true");
  await expect(table).toHaveAttribute("data-demo-active", "false");
  await expect(table).toHaveAttribute("data-startup-phase", "live");
  assert.equal(Number(await table.getAttribute("data-startup-ui-opacity")), 1);
  await pause(600);
  await expect(table).toHaveAttribute("data-graphics-intro", "true");
  await expect(table).toHaveAttribute("data-demo-active", "false");
  assert.equal(Number(await table.getAttribute("data-startup-ui-opacity")), 1);
  assert.deepEqual(
    latestState,
    playing,
    "live graphics measurements cannot change the ledger",
  );
  await capture("live-retest");
  await page.keyboard.press("Escape");
  await expect(table).toHaveAttribute("data-graphics-intro", "false");
  await expect(table).toHaveAttribute("data-demo-active", "false");
  assert.equal(Number(await table.getAttribute("data-startup-ui-opacity")), 1);
  assert.deepEqual(latestState, playing);
  assert.deepEqual(errors, []);
  assert.deepEqual(glErrors, []);
  await writeFile(
    "artifacts/startup-qa.json",
    JSON.stringify(
      {
        ok: true,
        port,
        blackPixels,
        wearBlackPixels,
        scratchBlackPixels,
        actualDuration,
        contentDuration,
        uploadPausedMs,
        qualityChanges,
        actualChanges,
        samples,
        errors,
        glErrors,
      },
      null,
      2,
    ),
  );
  console.log(
    "Startup proof passed: black gated wood, dice wear, chip scratches, wool atlas and vector board, actual30s content with accounted resource waits, two physical throws, real winning/losing modeled transfers, late UI fade, isolated ledger, Escape, already-playing skip and live-game Retest.",
  );
} catch (error) {
  await mkdir("artifacts", { recursive: true });
  await writeFile(
    "artifacts/startup-failure.json",
    JSON.stringify(
      {
        message: error.stack || error.message,
        samples: await page
          ?.evaluate(() => window.startupSamples)
          .catch(() => []),
        errors,
        glErrors,
        serverLog,
      },
      null,
      2,
    ),
  );
  throw error;
} finally {
  releaseAsset?.();
  releaseWear?.();
  releaseScratch?.();
  extraAssetGates.forEach((gate) => gate.release());
  socket?.terminate();
  await browser?.close();
  if (server.exitCode === null) {
    server.kill("SIGTERM");
    await Promise.race([
      new Promise((resolve) => server.once("exit", resolve)),
      pause(3000),
    ]);
    if (server.exitCode === null) server.kill("SIGKILL");
  }
}
