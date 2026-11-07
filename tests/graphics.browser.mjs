// Full renderer + real room authority. Uses an isolated port and never joins user rooms.
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import assert from "node:assert/strict";
import { chromium, expect } from "@playwright/test";
import { WebSocket } from "ws";
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
      viewport: { width: 1280, height: 800 },
    }),
    errors = [],
    glErrors = [];
  page.on("pageerror", (e) => errors.push(e.message));
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
  await expect(table).toHaveAttribute("data-graphics-intro", "false", {
    timeout: 20000,
  });
  const click = (x, y) => page.locator("canvas").click({ position: { x, y } });
  await click(48, 48);
  await click(130, 400);
  await expect(table).toHaveAttribute("data-graphics-page", "graphics");
  await click(170, 155);
  await expect(table).toHaveAttribute("data-graphics-fps", "24");
  if (!process.env.CI) {
    await expect
      .poll(async () => {
        const fps = Number(await table.getAttribute("data-render-fps"));
        return fps >= 20 && fps <= 28;
      })
      .toBe(true);
  }
  await click(170, 155);
  await expect(table).toHaveAttribute("data-graphics-fps", "30");
  await click(170, 155);
  await expect(table).toHaveAttribute("data-graphics-fps", "60");
  await click(170, 197); // auto -> on
  await click(170, 197); // on -> off, rebuild WebGL
  await expect
    .poll(
      async () =>
        JSON.parse((await table.getAttribute("data-graphics")) || "{}")
          .antialias,
    )
    .toBe("off");
  await expect(table).toHaveAttribute("data-scene-ready", "true", {
    timeout: 45000,
  });
  await expect(table).toHaveAttribute("data-graphics-page", "graphics");
  assert.equal(
    await page
      .locator("canvas")
      .evaluate((c) => c.getContext("webgl2").getContextAttributes().antialias),
    false,
  );
  await click(170, 239); // auto -> 75 percent native pixels
  await expect
    .poll(() => page.locator("canvas").evaluate((c) => c.width))
    .toBe(960);
  await click(170, 281);
  await click(170, 281); // auto -> full -> optimized
  await expect(table).toHaveAttribute("data-graphics-model", "optimized");
  await click(170, 323);
  await expect(table).toHaveAttribute("data-graphics-textures", "1024");
  await click(170, 323); // 1K -> 2K must reallocate GPU storage safely.
  await expect(table).toHaveAttribute("data-graphics-textures", "2048");
  await click(170, 323); // Native
  const gpuTextureLimit = await page.locator("canvas").evaluate((canvas) => {
    const gl = canvas.getContext("webgl2");
    return gl.getParameter(gl.MAX_TEXTURE_SIZE);
  });
  await expect
    .poll(async () =>
      Number(await table.getAttribute("data-graphics-textures")),
    )
    .toBe(gpuTextureLimit);
  await click(170, 323); // Auto
  await click(170, 323); // 1K again, retained across reload
  await expect(table).toHaveAttribute("data-graphics-textures", "1024");
  await click(170, 447);
  await expect(table).toHaveAttribute("data-graphics-intro", "true");
  await expect(table).toHaveAttribute("data-graphics-intro", "false", {
    timeout: 20000,
  });
  await expect(table).toHaveAttribute("data-graphics-fps", "60");
  await page.reload();
  await expect(table).toHaveAttribute("data-scene-ready", "true", {
    timeout: 45000,
  });
  await expect(table).toHaveAttribute("data-graphics-intro", "false", {
    timeout: 20000,
  });
  await expect(table).toHaveAttribute("data-graphics-textures", "1024");
  assert.equal(await page.locator("canvas").evaluate((c) => c.width), 960);
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
  await click(48, 48);
  await click(130, 400);
  await expect(table).toHaveAttribute("data-graphics-page", "graphics");
  await mkdir("artifacts", { recursive: true });
  await page.screenshot({ path: "artifacts/graphics-integrated.png" });
  assert.deepEqual(errors, []);
  assert.deepEqual(glErrors, []);
  console.log(
    JSON.stringify({
      ok: true,
      checks: [
        "intro calibration",
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
