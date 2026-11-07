// Full renderer + real room authority. Uses an isolated port and never joins user rooms.
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import assert from "node:assert/strict";
import { chromium, expect } from "@playwright/test";
import { WebSocket } from "ws";
import { clickTV } from "./helpers/tv-actions.mjs";
// This checks real context/input behavior rather than native-resolution visual
// fidelity (covered separately). Full-size software MSAA can saturate a Linux
// runner and block Chromium's acknowledgement of the click that enables it.
const viewport = process.env.CI
  ? { width: 800, height: 500 }
  : { width: 1280, height: 800 };
const scaledResolution = `${Math.floor(viewport.width * 0.75)}x${Math.floor(viewport.height * 0.75)}`;
const nativeResolution = `${viewport.width}x${viewport.height}`;
const port = 4449;
const server = spawn(process.execPath, ["server/index.js"], {
  env: {
    ...process.env,
    PORT: String(port),
    CRAPSTV_MDNS: "0",
    CRAPSTV_JOIN_MODE: "ip",
  },
  stdio: "ignore",
});
let browser, ws;
try {
  let config;
  for (let i = 0; i < 100; i++) {
    try {
      config = await (
        await fetch(`http://127.0.0.1:${port}/api/config`)
      ).json();
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  assert(config);
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
  const page = await browser.newPage({
      viewport,
    }),
    errors = [],
    glErrors = [];
  page.on("pageerror", (e) => errors.push(e.stack || e.message));
  page.on("console", (message) => {
    if (
      /GL_INVALID|INVALID_OPERATION|INVALID_VALUE|texSubImage.*error/i.test(
        message.text(),
      )
    )
      glErrors.push(message.text());
  });
  await page.goto(`http://127.0.0.1:${port}`);
  const table = page.locator(".table-canvas");
  await expect(table).toHaveAttribute("data-scene-ready", "true", {
    timeout: 45000,
  });
  await page.keyboard.press("Escape");
  await expect(table).toHaveAttribute("data-graphics-intro", "false", {
    timeout: 20000,
  });
  const cameraPose = () =>
    table.evaluate((el) => ({
      eye: JSON.parse(el.dataset.cameraPosition),
      target: JSON.parse(el.dataset.cameraTarget),
    }));
  // A modifier pan translates eye and target together; ordinary drag orbits.
  const dragStart = { x: viewport.width / 2, y: viewport.height * 0.4375 };
  const dragEnd = { x: viewport.width * 0.578125, y: dragStart.y };
  await page.mouse.move(dragStart.x, dragStart.y);
  await page.keyboard.down("Shift");
  await page.mouse.down();
  await expect(table).toHaveAttribute("data-camera-manual", "true");
  const beforePan = await cameraPose();
  await page.mouse.move(dragEnd.x, dragEnd.y, { steps: 12 });
  await page.mouse.up();
  await page.keyboard.up("Shift");
  await expect
    .poll(async () => {
      const p = await cameraPose();
      return Math.hypot(...p.target.map((n, i) => n - beforePan.target[i]));
    })
    .toBeGreaterThan(0.1);
  const afterPan = await cameraPose();
  assert(
    Math.hypot(
      ...afterPan.eye.map(
        (n, i) =>
          n - afterPan.target[i] - (beforePan.eye[i] - beforePan.target[i]),
      ),
    ) < 0.02,
    "Shift drag keeps the viewing angle while translating",
  );
  await page.waitForTimeout(500);
  const beforeOrbit = await cameraPose();
  await page.mouse.move(dragStart.x, dragStart.y);
  await page.mouse.down();
  await page.mouse.move(dragEnd.x, dragEnd.y, { steps: 12 });
  await page.mouse.up();
  await expect
    .poll(async () => {
      const p = await cameraPose();
      return Math.hypot(...p.eye.map((n, i) => n - beforeOrbit.eye[i]));
    })
    .toBeGreaterThan(0.1);
  await expect(table).toHaveAttribute("data-camera-manual", "true");
  const click = (action) => clickTV(page, action);
  // Auto can already resolve to the requested effective value (e.g. 1K on
  // SwiftShader). Wait for the rendered requested setting before clicking
  // again, so a matching effective cap cannot hide an unprocessed click.
  const requested = (key, value) =>
    expect
      .poll(
        async () =>
          JSON.parse((await table.getAttribute("data-graphics")) || "{}")[key],
        { timeout: 20000 },
      )
      .toBe(value);
  await click("settings");
  await click("graphics");
  await expect(table).toHaveAttribute("data-graphics-page", "graphics");
  await click("graphics:fps");
  await requested("fps", 24);
  await expect(table).toHaveAttribute("data-graphics-fps", "24");
  if (!process.env.CI) {
    await expect
      .poll(async () => {
        const fps = Number(await table.getAttribute("data-render-fps"));
        return fps >= 20 && fps <= 28;
      })
      .toBe(true);
  }
  await click("graphics:fps");
  await requested("fps", 30);
  await expect(table).toHaveAttribute("data-graphics-fps", "30");
  await click("graphics:fps");
  await requested("fps", 60);
  await expect(table).toHaveAttribute("data-graphics-fps", "60");
  await click("graphics:antialias"); // auto -> on
  await requested("antialias", "on");
  await expect(table).toHaveAttribute("data-scene-ready", "true", {
    timeout: 45000,
  });
  const actualAntialias = () =>
    page
      .locator("canvas")
      .evaluate(
        (canvas) =>
          canvas.getContext("webgl2").getContextAttributes().antialias,
      );
  assert.equal(
    await actualAntialias(),
    true,
    "On creates an actual MSAA context",
  );
  await click("graphics:antialias"); // on -> off, rebuild WebGL
  await requested("antialias", "off");
  await expect(table).toHaveAttribute("data-scene-ready", "true", {
    timeout: 45000,
  });
  await expect(table).toHaveAttribute("data-graphics-page", "graphics");
  assert.equal(
    await actualAntialias(),
    false,
    "Off recreates a non-MSAA context",
  );
  await click("graphics:resolution"); // auto -> 75 percent native pixels
  await requested("resolution", "75");
  await expect(table).toHaveAttribute(
    "data-scene-resolution",
    scaledResolution,
  );
  await expect(table).toHaveAttribute("data-ui-resolution", nativeResolution);
  await click("graphics:modelDetail");
  await requested("modelDetail", "full");
  await click("graphics:modelDetail"); // auto -> full -> optimized
  await requested("modelDetail", "optimized");
  await expect(table).toHaveAttribute("data-graphics-model", "optimized");
  await click("graphics:textures");
  await requested("textures", "1k");
  await expect(table).toHaveAttribute("data-graphics-textures", "1024");
  await click("graphics:textures"); // 1K -> 2K must reallocate GPU storage safely.
  await requested("textures", "2k");
  await expect(table).toHaveAttribute("data-graphics-textures", "2048");
  await click("graphics:textures"); // 4K
  await requested("textures", "4k");
  await expect(table).toHaveAttribute("data-graphics-textures", "4096");
  await click("graphics:textures"); // Native
  await requested("textures", "native");
  const gpuTextureLimit = await page.locator("canvas").evaluate((canvas) => {
    const gl = canvas.getContext("webgl2");
    return gl.getParameter(gl.MAX_TEXTURE_SIZE);
  });
  await expect
    .poll(async () =>
      Number(await table.getAttribute("data-graphics-textures")),
    )
    .toBe(gpuTextureLimit);
  await click("graphics:textures"); // Auto
  await requested("textures", "auto");
  await click("graphics:textures"); // 1K again, retained across reload
  await requested("textures", "1k");
  await expect(table).toHaveAttribute("data-graphics-textures", "1024");
  await click("graphics:retest");
  await expect(table).toHaveAttribute("data-graphics-intro", "true");
  await page.keyboard.press("Escape");
  await expect(table).toHaveAttribute("data-graphics-intro", "false", {
    timeout: 20000,
  });
  await expect(table).toHaveAttribute("data-graphics-fps", "60");
  await page.reload();
  await expect(table).toHaveAttribute("data-scene-ready", "true", {
    timeout: 45000,
  });
  await page.keyboard.press("Escape");
  await expect(table).toHaveAttribute("data-graphics-intro", "false", {
    timeout: 20000,
  });
  await expect(table).toHaveAttribute("data-graphics-textures", "1024");
  await expect(table).toHaveAttribute(
    "data-scene-resolution",
    scaledResolution,
  );
  assert.deepEqual(
    await page
      .locator("canvas")
      .evaluate((canvas) => [canvas.width, canvas.height]),
    [viewport.width, viewport.height],
  );
  ws = new WebSocket(`ws://127.0.0.1:${port}/socket`);
  await new Promise((resolve, reject) => {
    ws.once("open", () =>
      ws.send(
        JSON.stringify({
          type: "join",
          name: "Graphics admin",
          code: config.code,
        }),
      ),
    );
    ws.on("message", (raw) => {
      const m = JSON.parse(raw);
      if (m.type === "welcome") resolve();
      if (m.type === "error") reject(Error(m.message));
    });
  });
  // Explicitly reselecting unchanged server Auto must replace local manual overrides.
  ws.send(
    JSON.stringify({
      type: "display",
      settings: {
        graphics: {
          fps: "auto",
          antialias: "auto",
          resolution: "auto",
          textures: "auto",
          modelDetail: "auto",
        },
      },
    }),
  );
  await expect
    .poll(
      async () =>
        JSON.parse((await table.getAttribute("data-graphics")) || "{}")
          .resolution,
    )
    .toBe("auto");
  await expect(table).toHaveAttribute("data-scene-ready", "true", {
    timeout: 45000,
  });
  await click("settings");
  await click("graphics");
  await expect(table).toHaveAttribute("data-graphics-page", "graphics");
  await mkdir("artifacts", { recursive: true });
  await page.screenshot({ path: "artifacts/graphics-integrated.png" });
  assert.deepEqual(errors, []);
  assert.deepEqual(glErrors, []);
  console.log(
    JSON.stringify({
      ok: true,
      viewport,
      checks: [
        "intro calibration",
        "Shift-left-drag pans and normal drag orbits",
        "24/30/60 FPS",
        "real antialias context recreation",
        "menu retained after recreation",
        "resolution render size",
        "forced model detail",
        "texture cap",
        "retest preserves overrides",
        "local preferences survive reload",
        "admin Auto overrides local settings",
      ],
      errors,
    }),
  );
} finally {
  ws?.close();
  await browser?.close();
  server.kill();
}
