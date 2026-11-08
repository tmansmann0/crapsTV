// Actual TV canvas controls and a real host phone on an isolated room authority.
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { chromium, expect } from "@playwright/test";
import { pngDifference } from "../scripts/png-difference.mjs";
import { clickTV } from "./helpers/tv-actions.mjs";

const port = 4453;
const origin = `http://127.0.0.1:${port}`;
const viewport = process.env.CI
  ? { width: 800, height: 500 }
  : { width: 1280, height: 800 };
const keys = ["lensFlares", "localReflections", "contactShadows"];
const labels = ["lens flares", "local reflections", "contact shadows"];
const effectTimeout = process.env.CI ? 90000 : 30000;
const errors = [],
  glErrors = [],
  checks = [],
  telemetry = [];
let serverLog = "",
  browser,
  tv;
const server = spawn(process.execPath, ["server/index.js", "--dev"], {
  env: {
    ...process.env,
    PORT: String(port),
    CRAPSTV_MDNS: "0",
    CRAPSTV_JOIN_MODE: "ip",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
server.stdout.on("data", (chunk) => {
  serverLog += chunk;
});
server.stderr.on("data", (chunk) => {
  serverLog += chunk;
});
function observe(page) {
  page.on("pageerror", (error) => errors.push(error.stack || error.message));
  page.on("console", (message) => {
    if (
      /GL_INVALID|INVALID_OPERATION|INVALID_VALUE|texSubImage.*error/i.test(
        message.text(),
      )
    )
      glErrors.push(message.text());
  });
}
try {
  let config;
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      config = await (await fetch(`${origin}/api/config`)).json();
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  assert(config, serverLog);
  browser = await chromium.launch({
    headless: true,
    args: [
      `--use-angle=${process.platform === "darwin" && !process.env.CI ? "metal" : "swiftshader"}`,
      "--enable-webgl",
      "--ignore-gpu-blocklist",
    ],
  });
  tv = await browser.newPage({ viewport });
  observe(tv);
  const table = tv.locator(".table-canvas");
  const graphics = async () =>
    JSON.parse(await table.getAttribute("data-graphics"));
  const reflections = async () =>
    JSON.parse(await table.getAttribute("data-local-reflections"));
  const requested = (key, value) =>
    expect
      .poll(async () => (await graphics())[key], { timeout: 30000 })
      .toBe(value);
  async function ready() {
    await expect(table).toHaveAttribute("data-scene-ready", "true", {
      timeout: 60000,
    });
    await tv.keyboard.press("Escape");
    await expect(table).toHaveAttribute("data-graphics-intro", "false", {
      timeout: 20000,
    });
    await expect(table).toHaveAttribute("data-startup-fade", "1", {
      timeout: 20000,
    });
  }
  async function openEffects() {
    if ((await table.getAttribute("data-settings-open")) !== "true")
      await clickTV(tv, "settings");
    if ((await table.getAttribute("data-graphics-page")) === "main")
      await clickTV(tv, "graphics");
    if ((await table.getAttribute("data-graphics-page")) !== "effects")
      await clickTV(tv, "graphics:effects");
    await expect(table).toHaveAttribute("data-graphics-page", "effects");
  }
  async function offResources() {
    await expect(table).toHaveAttribute("data-lens-flares", "false");
    await expect(table).toHaveAttribute("data-lens-flare-resources", "0");
    await expect(table).toHaveAttribute("data-contact-shadows", "false");
    await expect
      .poll(async () => {
        const status = await reflections();
        return (
          status.state === "off" &&
          !status.enabled &&
          status.size === 0 &&
          status.materials === 0 &&
          status.estimatedBytes === 0
        );
      })
      .toBe(true);
  }
  async function snapshot(label) {
    const status = await table.evaluate((element) => ({
      graphics: JSON.parse(element.dataset.graphics),
      reflections: JSON.parse(element.dataset.localReflections),
      contactShadows: element.dataset.contactShadows,
      contactShadowsSupported: element.dataset.contactShadowsSupported,
      contactShadowSize: element.dataset.contactShadowSize,
      flareSources: element.dataset.lensFlareSources,
      flareResources: element.dataset.lensFlareResources,
      lensFlares: element.dataset.lensFlares,
      uiResolution: element.dataset.uiResolution,
      sceneResolution: element.dataset.sceneResolution,
    }));
    telemetry.push({ label, ...status });
    console.log(`Optional effects: ${label}`);
    return status;
  }
  async function qrCapture() {
    const join = await table.evaluate(
      (element) => JSON.parse(element.dataset.uiTextMetrics).join,
    );
    const scale = join.scale;
    return tv.screenshot({
      clip: {
        x: Math.ceil(join.x + join.qr.x * scale + 2),
        y: Math.ceil(join.y + join.qr.y * scale + 2),
        width: Math.floor(join.qr.size * scale - 4),
        height: Math.floor(join.qr.size * scale - 4),
      },
    });
  }
  await tv.goto(origin);
  await ready();
  for (const key of keys) assert.equal((await graphics())[key], "off");
  await offResources();
  await snapshot("defaults-off");
  checks.push("all optional effects default Off with no effect resources");

  const phone = await browser.newPage({
    viewport: { width: 390, height: 844 },
    isMobile: true,
  });
  observe(phone);
  await phone.goto(`${origin}/join?code=${config.code}`);
  await phone.getByLabel("Your name").fill("Effects QA host");
  await phone.getByRole("button", { name: "Join", exact: true }).click();
  await phone.getByText("Table setup", { exact: true }).waitFor();
  await phone.getByText("Host controls", { exact: true }).click();
  for (const label of labels)
    await expect(phone.getByLabel(`TV graphics ${label}`)).toHaveValue("off");
  await openEffects();
  const uiBefore = await table.evaluate(
    (element) => JSON.parse(element.dataset.uiTextMetrics).join,
  );
  const qrBefore = await qrCapture();
  const baseShadowSize = Number(
    await table.getAttribute("data-contact-shadow-size"),
  );
  for (const key of keys) {
    await clickTV(tv, `graphics:${key}`);
    await requested(key, "on");
  }
  await expect(table).toHaveAttribute(
    "data-contact-shadows-supported",
    /^(true|false)$/,
  );
  const contactSupported =
    (await table.getAttribute("data-contact-shadows-supported")) === "true";
  const reflectionSupported = (await reflections()).supported;
  await expect(table).toHaveAttribute(
    "data-contact-shadows",
    String(contactSupported),
    {
      timeout: effectTimeout,
    },
  );
  await expect(table).toHaveAttribute("data-lens-flares", "true");
  await expect
    .poll(async () => (await reflections()).state, { timeout: effectTimeout })
    .toBe(reflectionSupported ? "ready" : "unsupported");
  await expect
    .poll(async () =>
      table.evaluate(
        (element) =>
          JSON.parse(element.dataset.uiTextMetrics).graphics.lines.filter(
            (line) => line.text === "Unavailable on this renderer",
          ).length,
      ),
    )
    .toBe(Number(!contactSupported) + Number(!reflectionSupported));
  const allOn = await snapshot("tv-all-on");
  assert.equal(allOn.reflections.error, null);
  if (reflectionSupported) {
    assert(allOn.reflections.commits >= 1);
    assert(allOn.reflections.estimatedBytes > 0);
  } else {
    assert.equal(allOn.reflections.commits, 0);
    assert.equal(allOn.reflections.estimatedBytes, 0);
    assert.equal(allOn.reflections.size, 0);
  }
  if (contactSupported)
    assert(Number(allOn.contactShadowSize) >= baseShadowSize);
  else assert.equal(Number(allOn.contactShadowSize), baseShadowSize);
  const qrOn = await qrCapture();
  assert.equal(
    pngDifference(qrBefore, qrOn).changedPixels,
    0,
    "the join QR stays pixel-exact after enabling every effect",
  );
  const uiOn = await table.evaluate(
    (element) => JSON.parse(element.dataset.uiTextMetrics).join,
  );
  assert.deepEqual(
    uiOn.lines,
    uiBefore.lines,
    "join address/code typography remains unchanged",
  );
  assert.equal(uiOn.backingWidth, uiBefore.backingWidth);
  assert.equal(uiOn.backingHeight, uiBefore.backingHeight);
  checks.push(
    "TV Effects submenu controls all three effects; QR pixels and native text backing remain sharp",
  );

  for (const key of keys) {
    await clickTV(tv, `graphics:${key}`);
    await requested(key, "off");
  }
  await offResources();
  assert.equal(
    Number(await table.getAttribute("data-contact-shadow-size")),
    baseShadowSize,
  );
  await snapshot("tv-all-off-restored");
  for (const key of keys) {
    await clickTV(tv, `graphics:${key}`);
    await requested(key, "on");
  }
  await tv.reload();
  await ready();
  for (const key of keys) await requested(key, "on");
  checks.push(
    "local effect choices survive TV reload; Off restores baseline contact shadows and frees effect resources",
  );

  await openEffects();
  for (let i = 0; i < keys.length; i++) {
    await phone.getByLabel(`TV graphics ${labels[i]}`).selectOption("on");
    await requested(keys[i], "on");
    await phone.getByLabel(`TV graphics ${labels[i]}`).selectOption("off");
    await requested(keys[i], "off");
  }
  await offResources();
  for (const mode of ["off", "on", "off"]) {
    await phone.getByLabel("TV graphics antialiasing").selectOption(mode);
    await requested("antialias", mode);
    await ready();
    await expect(table).toHaveAttribute("data-graphics-page", "effects");
    assert.equal(
      await table
        .locator("canvas")
        .evaluate(
          (canvas) =>
            canvas.getContext("webgl2").getContextAttributes().antialias,
        ),
      mode === "on",
    );
  }
  await offResources();
  await snapshot("phone-off-after-context-recreation");
  checks.push(
    "real admin phone controls all effects; Effects submenu survives MSAA context recreation in both directions",
  );
  await mkdir("artifacts/optional-effects", { recursive: true });
  await tv.screenshot({ path: "artifacts/optional-effects/tv-effects.png" });
  await phone.screenshot({
    path: "artifacts/optional-effects/phone-settings.png",
    fullPage: true,
  });
  await writeFile("artifacts/optional-effects/qr-before.png", qrBefore);
  await writeFile("artifacts/optional-effects/qr-on.png", qrOn);
  assert.deepEqual(errors, []);
  assert.deepEqual(glErrors, []);
  const report = { ok: true, viewport, checks, telemetry, errors, glErrors };
  await writeFile(
    "artifacts/optional-effects/report.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  await mkdir("artifacts/optional-effects", { recursive: true });
  await tv
    ?.screenshot({ path: "artifacts/optional-effects/failure.png" })
    .catch(() => {});
  await writeFile(
    "artifacts/optional-effects/failure.json",
    JSON.stringify(
      { error: error.stack, errors, glErrors, serverLog, telemetry },
      null,
      2,
    ) + "\n",
  );
  throw error;
} finally {
  await browser?.close();
  server.kill();
}
