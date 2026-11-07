// Isolated, real-WebGL TV benchmark. No existing room is changed.
import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { WebSocket } from "ws";
const port = Number(process.env.BENCH_PORT || 4398);
const label = process.env.BENCH_LABEL || "render";
const duration = Number(process.env.BENCH_MS || 6000);
const server = spawn(process.execPath, ["server/index.js"], {
  env: {
    ...process.env,
    PORT: String(port),
    CRAPSTV_MDNS: "0",
    CRAPSTV_JOIN_MODE: "ip",
  },
  stdio: "ignore",
});
let browser;
const sockets = [];
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
  if (!config) throw Error("Benchmark server did not start");
  browser = await chromium.launch({
    headless: true,
    args: [
      process.platform === "darwin"
        ? "--use-angle=metal"
        : "--use-angle=swiftshader",
      "--enable-webgl",
      "--ignore-gpu-blocklist",
    ],
  });
  const page = await browser.newPage({
    viewport: { width: 1600, height: 1000 },
  });
  await page.addInitScript(() => {
    const data = (window.__renderBench = {
      draws: 0,
      triangles: 0,
      frames: [],
      record: false,
    });
    for (const type of ["WebGLRenderingContext", "WebGL2RenderingContext"]) {
      const proto = window[type]?.prototype;
      if (!proto) continue;
      for (const method of [
        "drawElements",
        "drawArrays",
        "drawElementsInstanced",
        "drawArraysInstanced",
      ]) {
        const original = proto[method];
        if (!original) continue;
        proto[method] = function (...args) {
          data.draws++;
          if (args[0] === 4)
            data.triangles +=
              ((method.includes("Elements") ? args[1] : args[2]) *
                (method.endsWith("Instanced") ? args.at(-1) : 1)) /
              3;
          return original.apply(this, args);
        };
      }
    }
    let previousDraws = 0,
      previousTriangles = 0;
    const frame = (time) => {
      if (data.record && data.draws > previousDraws)
        data.frames.push({
          time,
          draws: data.draws - previousDraws,
          triangles: data.triangles - previousTriangles,
          cinematic:
            document.querySelector(".table-canvas")?.dataset.cinematic ===
            "true",
        });
      previousDraws = data.draws;
      previousTriangles = data.triangles;
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  });
  await page.goto(`http://127.0.0.1:${port}`);
  await page.waitForFunction(
    () =>
      document.querySelector(".table-canvas")?.dataset.sceneReady === "true",
    null,
    { timeout: 60000 },
  );
  await page.waitForFunction(
    () =>
      document.querySelector(".table-canvas")?.dataset.graphicsIntro ===
      "false",
    null,
    { timeout: 20000 },
  );
  for (let i = 0; i < 12; i++) {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/socket`);
    sockets.push(ws);
    await new Promise((resolve, reject) => {
      ws.once("open", () =>
        ws.send(
          JSON.stringify({
            type: "join",
            code: config.code,
            name: `Player ${i + 1}`,
          }),
        ),
      );
      ws.on("message", (raw) => {
        const m = JSON.parse(raw);
        if (m.type === "welcome") resolve();
        if (m.type === "error") reject(Error(m.message));
      });
    });
  }
  sockets[0].send(
    JSON.stringify({ type: "start", config: { rollCooldownSeconds: 0 } }),
  );
  await page.waitForTimeout(200);
  for (const ws of sockets)
    ws.send(JSON.stringify({ type: "bet", betId: "pass", amount: 2500 }));
  await page.waitForTimeout(2000);
  await page.evaluate(() => {
    window.__renderBench.record = true;
  });
  if (process.env.BENCH_ROLL === "1")
    sockets[0].send(
      JSON.stringify({ type: "roll", gesture: { x: 0.3, power: 0.8 } }),
    );
  await page.waitForTimeout(duration);
  const result = await page.evaluate(() => {
    const data = window.__renderBench;
    data.record = false;
    const intervals = data.frames
      .slice(1)
      .map((f, i) => f.time - data.frames[i].time)
      .sort((a, b) => a - b);
    const avg = (key) =>
      data.frames.reduce((sum, f) => sum + f[key], 0) / data.frames.length;
    const canvas = document.querySelector(".table-canvas canvas"),
      gl = canvas.getContext("webgl2") || canvas.getContext("webgl"),
      ext = gl.getExtension("WEBGL_debug_renderer_info");
    const rolling = data.frames.filter((frame) => frame.cinematic);
    return {
      frames: data.frames.length,
      fps:
        (1000 * (data.frames.length - 1)) /
        (data.frames.at(-1).time - data.frames[0].time),
      p50Ms: intervals[Math.floor(intervals.length * 0.5)],
      p95Ms: intervals[Math.floor(intervals.length * 0.95)],
      meanDraws: avg("draws"),
      meanTriangles: avg("triangles"),
      renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : "unknown",
      width: canvas.width,
      height: canvas.height,
      rollingFps:
        rolling.length > 1
          ? (1000 * (rolling.length - 1)) /
            (rolling.at(-1).time - rolling[0].time)
          : null,
    };
  });
  await mkdir("artifacts", { recursive: true });
  await page.screenshot({ path: `artifacts/${label}.png` });
  await writeFile(`artifacts/${label}.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} finally {
  for (const ws of sockets) ws.close();
  await browser?.close();
  server.kill();
}
