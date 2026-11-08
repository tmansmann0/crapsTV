// Isolated real-WebGL benchmark. Explicit settings prevent Auto/CI from silently
// lowering the framebuffer while a report is labelled "1080p" or "4K".
// Example: BENCH_WIDTH=3840 BENCH_HEIGHT=2160 BENCH_DPR=1 npm run benchmark
import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { WebSocket } from "ws";
import {
  benchmarkConfig,
  assertBenchmarkResolution,
  benchmarkEffectsStatus,
} from "./benchmark-config.mjs";
const config = benchmarkConfig(process.env);
const { port, label, duration } = config;
// Refuse an occupied port rather than accidentally joining an existing room.
await new Promise((resolve, reject) => {
  const probe = createServer();
  probe.once("error", reject);
  probe.listen(port, "127.0.0.1", () => probe.close(resolve));
});
const server = spawn(
  process.execPath,
  ["server/index.js", ...(config.dev ? ["--dev"] : [])],
  {
    env: {
      ...process.env,
      PORT: String(port),
      CRAPSTV_MDNS: "0",
      CRAPSTV_JOIN_MODE: "ip",
    },
    stdio: "ignore",
  },
);
let browser;
const sockets = [];
try {
  let room;
  for (let i = 0; i < 100; i++) {
    try {
      room = await (await fetch(`http://127.0.0.1:${port}/api/config`)).json();
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  if (!room) throw new Error("Benchmark server did not start");
  browser = await chromium.launch({
    headless: true,
    args: [
      `--use-angle=${config.angle}`,
      "--enable-webgl",
      "--ignore-gpu-blocklist",
    ],
  });
  const page = await browser.newPage({
    viewport: { width: config.width, height: config.height },
    deviceScaleFactor: config.dpr,
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(
    ({ graphics, uiSize }) => {
      localStorage.setItem("crapstv-graphics-v1", JSON.stringify(graphics));
      if (uiSize === "large")
        localStorage.setItem("crapstv-tv-ui-size-v1", "large");
      else localStorage.removeItem("crapstv-tv-ui-size-v1");
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
      function frame(time) {
        if (data.record && data.draws > previousDraws)
          data.frames.push({
            time,
            draws: data.draws - previousDraws,
            triangles: data.triangles - previousTriangles,
            cinematic:
              document.querySelector(".table-canvas")?.dataset.cinematic ===
              "true",
            shot:
              document.querySelector(".table-canvas")?.dataset.cameraVariant ||
              document.querySelector(".table-canvas")?.dataset.cameraShot ||
              "overview",
          });
        previousDraws = data.draws;
        previousTriangles = data.triangles;
        requestAnimationFrame(frame);
      }
      requestAnimationFrame(frame);
    },
    { graphics: config.graphics, uiSize: config.uiSize },
  );
  await page.goto(`http://127.0.0.1:${port}`);
  await page.waitForFunction(
    () =>
      document.querySelector(".table-canvas")?.dataset.sceneReady === "true",
    null,
    { timeout: 60000 },
  );
  // The opening has its own end-to-end check; benchmark actual room play.
  await page.keyboard.press("Escape");
  await page.waitForFunction(
    () =>
      document.querySelector(".table-canvas")?.dataset.graphicsIntro ===
      "false",
    null,
    { timeout: 30000 },
  );
  for (let i = 0; i < config.players; i++) {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/socket`);
    sockets.push(ws);
    await new Promise((resolve, reject) => {
      ws.once("open", () =>
        ws.send(
          JSON.stringify({
            type: "join",
            code: room.code,
            name: `Player ${i + 1}`,
          }),
        ),
      );
      ws.on("message", (raw) => {
        const m = JSON.parse(raw);
        if (m.type === "welcome") resolve();
        if (m.type === "error") reject(new Error(m.message));
      });
      ws.once("error", reject);
    });
  }
  sockets[0].send(
    JSON.stringify({
      type: "display",
      settings: { camera: config.camera, graphics: config.graphics },
    }),
  );
  sockets[0].send(
    JSON.stringify({ type: "start", config: { rollCooldownSeconds: 0 } }),
  );
  await page.waitForTimeout(250);
  for (const ws of sockets)
    ws.send(JSON.stringify({ type: "bet", betId: "pass", amount: 2500 }));
  await page.waitForTimeout(1800);
  const effectsWaitStarted = Date.now();
  await page.waitForFunction(
    (expected) => {
      const d = document.querySelector(".table-canvas")?.dataset;
      if (!d) return false;
      try {
        const requested = JSON.parse(d.graphics),
          probe = JSON.parse(d.localReflections);
        if (
          !["lensFlares", "localReflections", "contactShadows"].every(
            (key) => requested[key] === expected,
          )
        )
          return false;
        if (d.lensFlares === undefined || d.contactShadows === undefined)
          return false;
        return expected === "off"
          ? probe.state === "off"
          : ["unsupported", "error"].includes(probe.state) ||
              (probe.state === "ready" &&
                d.localReflectionRevision !== undefined &&
                probe.revision === Number(d.localReflectionRevision));
      } catch {
        return false;
      }
    },
    config.effects,
    { timeout: 60000 },
  );
  const effectsBefore = benchmarkEffectsStatus(
    config,
    await page.evaluate(() => ({
      ...document.querySelector(".table-canvas").dataset,
    })),
  );
  if (!effectsBefore.verified)
    throw Error(
      `Effects benchmark mismatch before measurement: ${effectsBefore.reasons.join("; ")}`,
    );
  const effectsWarmupMs = Date.now() - effectsWaitStarted;
  await page.evaluate(() => {
    window.__renderBench.frames = [];
    window.__renderBench.record = true;
  });
  if (config.roll)
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
      data.frames.length
        ? data.frames.reduce((sum, f) => sum + f[key], 0) / data.frames.length
        : null;
    const fps = (frames) =>
      frames.length > 1
        ? (1000 * (frames.length - 1)) / (frames.at(-1).time - frames[0].time)
        : null;
    const canvas = document.querySelector(".table-canvas canvas");
    const gl = canvas.getContext("webgl2") || canvas.getContext("webgl");
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    const shotIntervals = new Map();
    data.frames.slice(1).forEach((frame, index) => {
      const previous = data.frames[index];
      if (previous.shot !== frame.shot) return;
      const delta = frame.time - previous.time;
      if (!shotIntervals.has(frame.shot)) shotIntervals.set(frame.shot, []);
      shotIntervals.get(frame.shot).push(delta);
    });
    const shots = Object.fromEntries(
      [...shotIntervals].map(([shot, intervals]) => {
        const ordered = [...intervals].sort((a, b) => a - b);
        return [
          shot,
          {
            intervals: intervals.length,
            fps:
              (1000 * intervals.length) /
              intervals.reduce((sum, v) => sum + v, 0),
            p95Ms: ordered[Math.floor(ordered.length * 0.95)],
          },
        ];
      }),
    );
    return {
      frames: data.frames.length,
      fps: fps(data.frames),
      p50Ms: intervals[Math.floor(intervals.length * 0.5)] ?? null,
      p95Ms: intervals[Math.floor(intervals.length * 0.95)] ?? null,
      meanDraws: avg("draws"),
      meanTriangles: avg("triangles"),
      renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : "unknown",
      width: gl.drawingBufferWidth,
      height: gl.drawingBufferHeight,
      rollingFps: fps(data.frames.filter((f) => f.cinematic)),
      shots,
      devicePixelRatio,
      viewport: { width: innerWidth, height: innerHeight },
      modules: performance
        .getEntriesByType("resource")
        .map((entry) => new URL(entry.name).pathname)
        .filter((path) => path.endsWith(".js"))
        .sort(),
      canvases: [...document.querySelectorAll(".table-canvas canvas")].map(
        (c) => ({
          width: c.width,
          height: c.height,
          cssWidth: c.clientWidth,
          cssHeight: c.clientHeight,
        }),
      ),
      effective: { ...document.querySelector(".table-canvas").dataset },
      limits: {
        maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE),
        maxRenderbufferSize: gl.getParameter(gl.MAX_RENDERBUFFER_SIZE),
        maxViewportDims: Array.from(gl.getParameter(gl.MAX_VIEWPORT_DIMS)),
      },
    };
  });
  const report = {
    configuration: config,
    applicationVersion: JSON.parse(await readFile("package.json", "utf8"))
      .version,
    sourceMode: config.dev ? "development" : "production",
    ...result,
    errors,
    effectsBefore,
    // Live throws intentionally retain the last complete probe while their
    // scene changes. Only the measurement START must have a current warm map.
    effectsAfter: benchmarkEffectsStatus(config, result.effective, {
      requireCurrent: false,
    }),
    effectsWarmupMs,
    effectsTiming:
      "Warm scene after player/bet setup; reported wait begins after the fixed1800ms setup settle and excludes initial opt-in cold compilation.",
  };
  const dimensions = (value, fallback) => {
    const match = String(value || "").match(/^(\d+)\s*[x×]\s*(\d+)$/);
    return match
      ? { width: Number(match[1]), height: Number(match[2]) }
      : fallback;
  };
  report.sceneFramebuffer = dimensions(result.effective.sceneResolution, {
    width: result.width,
    height: result.height,
  });
  report.uiFramebuffer = dimensions(result.effective.uiResolution, {
    width: result.width,
    height: result.height,
  });
  report.nativeUIVerified =
    report.uiFramebuffer.width === Math.floor(config.width * config.dpr) &&
    report.uiFramebuffer.height === Math.floor(config.height * config.dpr);
  try {
    report.resolutionVerified = assertBenchmarkResolution(
      config,
      report.sceneFramebuffer,
    );
  } catch (error) {
    report.resolutionVerified = false;
    report.resolutionFailure = error.message;
  }
  await mkdir("artifacts", { recursive: true });
  await page.screenshot({ path: `artifacts/${label}.png` });
  await writeFile(`artifacts/${label}.json`, JSON.stringify(report, null, 2));
  console.log(
    JSON.stringify({
      configuration: config,
      sourceMode: report.sourceMode,
      renderer: report.renderer,
      frames: report.frames,
      fps: report.fps,
      p95Ms: report.p95Ms,
      meanDraws: report.meanDraws,
      meanTriangles: report.meanTriangles,
      sceneFramebuffer: report.sceneFramebuffer,
      uiFramebuffer: report.uiFramebuffer,
      resolutionVerified: report.resolutionVerified,
      nativeUIVerified: report.nativeUIVerified,
      effectsBefore: report.effectsBefore,
      effectsAfter: report.effectsAfter,
      effectsWarmupMs,
      errors,
      report: `artifacts/${label}.json`,
    }),
  );
  if (report.resolutionFailure) throw new Error(report.resolutionFailure);
  if (!report.effectsAfter.verified)
    throw Error(
      `Effects benchmark mismatch after measurement: ${report.effectsAfter.reasons.join("; ")}`,
    );
  if (!report.nativeUIVerified && process.env.BENCH_REQUIRE_NATIVE_UI !== "0")
    throw new Error(
      "UI framebuffer is not native. Inspect the report; set BENCH_REQUIRE_NATIVE_UI=0 only to record a known fallback.",
    );
  if (errors.length) throw new Error(`Browser errors: ${errors.join("; ")}`);
} finally {
  for (const ws of sockets) ws.close();
  await browser?.close();
  server.kill();
}
