// Real presented-frame qualification on an isolated authority; no synthetic
// performance samples. Memory is known explicitly so hardware eligibility is
// deterministic even where navigator.deviceMemory is absent (e.g. macOS).
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium, expect } from "@playwright/test";
import { WebSocket } from "ws";
import { clickTV } from "./helpers/tv-actions.mjs";

const port = 4457;
const origin = `http://127.0.0.1:${port}`;
const folder = process.env.AUTO_EFFECTS_OUTPUT || "artifacts/auto-effects";
const keys = ["lensFlares", "localReflections", "contactShadows"];
const viewport = process.env.CI
  ? { width: 800, height: 500 }
  : { width: 1280, height: 800 };
const errors = [],
  glErrors = [],
  snapshots = [],
  checks = [];
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let browser,
  page,
  ws,
  state,
  serverLog = "";
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
const send = (message) => ws.send(JSON.stringify(message));
async function waitState(predicate) {
  for (let attempt = 0; attempt < 400; attempt++) {
    if (state && predicate(state)) return structuredClone(state);
    await pause(25);
  }
  throw Error("Isolated authority state timed out");
}
try {
  let config;
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      config = await (await fetch(`${origin}/api/config`)).json();
      break;
    } catch {
      await pause(100);
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
  page = await browser.newPage({ viewport });
  page.on("pageerror", (error) => errors.push(error.stack || error.message));
  page.on("console", (message) => {
    if (/GL_INVALID|INVALID_OPERATION|INVALID_VALUE/.test(message.text()))
      glErrors.push(message.text());
  });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "deviceMemory", {
      configurable: true,
      get: () => 8,
    });
    if (!localStorage.getItem("crapstv-graphics-v1"))
      localStorage.setItem(
        "crapstv-graphics-v1",
        JSON.stringify({
          fps: 60,
          resolution: "100",
          lensFlares: "auto",
          localReflections: "auto",
          contactShadows: "auto",
        }),
      );
    window.autoEffectFrames = [];
    const requestFrame = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (callback) =>
      requestFrame((at) => {
        callback(at);
        const data = document.querySelector(".table-canvas")?.dataset;
        if (!data?.autoEffects) return;
        const auto = JSON.parse(data.autoEffects);
        window.autoEffectFrames.push({
          at,
          flags: auto.flags,
          phase: auto.phase,
          pendingReset: auto.pendingReset,
          baselineSamples: auto.baselineSamples,
          trialSamples: auto.trialSamples,
          rolling: data.startupRolling,
          dice: JSON.parse(data.startupDicePose || "[]"),
          reflection: JSON.parse(data.localReflections || "{}"),
          contact: data.contactShadows,
          contactSize: data.contactShadowSize,
          flareResources: data.lensFlareResources,
        });
        if (window.autoEffectFrames.length > 4000)
          window.autoEffectFrames.shift();
      });
  });
  const table = page.locator(".table-canvas");
  const auto = async () =>
    JSON.parse(await table.getAttribute("data-auto-effects"));
  const graphics = async () =>
    JSON.parse(await table.getAttribute("data-graphics"));
  const resourceSignature = (frame) =>
    JSON.stringify([
      frame.flags,
      frame.reflection.enabled,
      frame.reflection.size,
      frame.reflection.captureDraws,
      frame.contact,
      frame.contactSize,
      frame.flareResources,
    ]);
  async function ready() {
    await expect(table).toHaveAttribute("data-scene-ready", "true", {
      timeout: 90000,
    });
    await page.keyboard.press("Escape");
    await expect(table).toHaveAttribute("data-graphics-intro", "false", {
      timeout: 20000,
    });
    await expect(table).toHaveAttribute("data-startup-fade", "1", {
      timeout: 20000,
    });
    await expect(table).toHaveAttribute("data-auto-effects", /^\{/);
  }
  async function openEffects() {
    if ((await table.getAttribute("data-settings-open")) !== "true")
      await clickTV(page, "settings");
    if ((await table.getAttribute("data-graphics-page")) === "main")
      await clickTV(page, "graphics");
    if ((await table.getAttribute("data-graphics-page")) !== "effects")
      await clickTV(page, "graphics:effects");
    await expect(table).toHaveAttribute("data-graphics-page", "effects");
  }
  async function chooseEffect(key, value) {
    for (let attempt = 0; attempt < 3; attempt++) {
      if ((await graphics())[key] === value) return;
      const before = (await graphics())[key];
      await clickTV(page, `graphics:${key}`);
      await expect.poll(async () => (await graphics())[key]).not.toBe(before);
    }
    assert.equal((await graphics())[key], value);
  }
  async function save(label) {
    const record = {
      label,
      automatic: await auto(),
      graphics: await graphics(),
      runtime: await table.evaluate((element) => ({
        reflection: JSON.parse(element.dataset.localReflections),
        contact: element.dataset.contactShadows,
        contactSize: element.dataset.contactShadowSize,
        flares: element.dataset.lensFlares,
        flareSources: element.dataset.lensFlareSources,
        flareResources: element.dataset.lensFlareResources,
      })),
    };
    snapshots.push(record);
    console.log(`Auto effects: ${label} (${record.automatic.phase})`);
    return record;
  }
  async function settledAutomatic() {
    await expect
      .poll(
        async () => {
          const status = await auto();
          return (
            ["accepted", "limited"].includes(status.phase) &&
            !status.pendingReset
          );
        },
        { timeout: 90000 },
      )
      .toBe(true);
  }
  await page.goto(origin);
  await ready();
  for (const key of keys) assert.equal((await graphics())[key], "auto");
  await expect(table).toHaveAttribute(
    "data-ui-resolution",
    `${viewport.width}x${viewport.height}`,
  );
  await expect(table).toHaveAttribute(
    "data-scene-resolution",
    `${viewport.width}x${viewport.height}`,
  );
  await settledAutomatic();
  const initial = await save("actual-device-qualification");
  const software =
    (await table.getAttribute("data-render-quality")) === "software";
  if (software) {
    assert.equal(initial.automatic.eligibility.localReflections, false);
    assert.equal(initial.automatic.eligibility.contactShadows, false);
    assert.equal(initial.automatic.flags.localReflections, false);
    assert.equal(initial.automatic.flags.contactShadows, false);
    assert.equal(initial.runtime.reflection.estimatedBytes, 0);
    assert.equal(initial.runtime.contact, "false");
    checks.push(
      "actual software renderer declines heavy Auto effects without allocating them",
    );
  } else {
    assert.equal(initial.automatic.eligibility.localReflections, true);
    assert.equal(initial.automatic.eligibility.contactShadows, true);
    assert.equal(
      initial.automatic.flags.localReflections,
      true,
      "known-memory native device must prove and accept real reflections",
    );
    assert.equal(
      initial.automatic.flags.contactShadows,
      true,
      "known-memory native device must prove and accept contact shadows",
    );
    const accepted = initial.automatic.reports.find(
      (report) => report.kind === "heavy" && report.accepted,
    );
    assert(accepted, "Auto acceptance has a measured trial report");
    assert(accepted.baselineSamples >= 45);
    assert(accepted.trialSamples >= 60);
    assert(Number.isFinite(accepted.baselineP80) && accepted.baselineP80 > 0);
    assert(Number.isFinite(accepted.p80) && accepted.p80 > 0);
    assert(accepted.p80 <= initial.automatic.budgetMs * 1.15);
    assert(accepted.p80 <= accepted.baselineP80 * 1.15 + 0.5);
    assert.equal(initial.runtime.reflection.state, "ready");
    assert(initial.runtime.reflection.commits >= 1);
    assert.equal(initial.runtime.contact, "true");
    checks.push(
      "actual hardware Auto accepts only after 45 baseline and 60 warmed resource-ready trial frames within the measured budget",
    );
  }
  await openEffects();
  await expect
    .poll(async () =>
      table.evaluate((element) =>
        JSON.parse(element.dataset.uiTextMetrics).graphics.lines.some((line) =>
          /^Auto\b.*\b(?:On|Off)\b/i.test(line.text),
        ),
      ),
    )
    .toBe(true);
  checks.push("TV Effects UI displays the resolved Auto On/Off result");

  ws = new WebSocket(`ws://127.0.0.1:${port}/socket`);
  ws.on("message", (raw) => {
    const message = JSON.parse(raw);
    if (message.type === "state") state = message.state;
    if (message.type === "error") errors.push(message.message);
  });
  await new Promise((resolve, reject) => {
    ws.once("open", resolve);
    ws.once("error", reject);
  });
  send({ type: "join", name: "Auto effects host", code: config.code });
  await waitState((value) => value.players.length === 1);
  if (!software) {
    assert.equal(initial.automatic.flags.lensFlares, false);
    assert.equal(initial.automatic.deferredLens, true);
    assert.equal(initial.runtime.flareResources, "0");
    send({ type: "display", settings: { camera: "room" } });
    await waitState((value) => value.display.camera === "room");
    await expect
      .poll(async () => (await auto()).lampVisible, { timeout: 30000 })
      .toBe(true);
    await expect
      .poll(
        async () =>
          (await auto()).reports.some((report) => report.kind === "lens"),
        { timeout: 90000 },
      )
      .toBe(true);
    const qualifiedLamp = await save("visible-real-lamp-qualified");
    const measuredLamp = qualifiedLamp.automatic.reports.find(
      (report) => report.kind === "lens",
    );
    assert.equal(measuredLamp.accepted, true);
    assert(measuredLamp.baselineSamples >= 45);
    assert(measuredLamp.trialSamples >= 60);
    assert(measuredLamp.p80 <= qualifiedLamp.automatic.budgetMs * 1.15);
    assert(measuredLamp.p80 <= measuredLamp.baselineP80 * 1.15 + 0.5);
    assert.equal(qualifiedLamp.automatic.flags.lensFlares, true);
    assert.equal(qualifiedLamp.runtime.flares, "true");
    assert(Number(qualifiedLamp.runtime.flareSources) >= 1);
    assert(Number(qualifiedLamp.runtime.flareResources) >= 1);
    assert.equal((await graphics()).lensFlares, "auto");
    checks.push(
      "Auto flares allocate nothing while lamps are hidden, then independently measure 45/60 real frames and accept actual HDR lamps in the room camera",
    );
  }
  send({ type: "start", config: { rollCooldownSeconds: 0 } });
  await waitState((value) => value.status === "playing");
  if (!software)
    await expect
      .poll(
        async () =>
          JSON.parse(await table.getAttribute("data-local-reflections")).state,
        { timeout: 30000 },
      )
      .toBe("ready");
  await pause(800);
  send({ type: "aim", aim: { active: true, x: 0.2, power: 0.6 } });
  await waitState((value) => value.aim?.active);
  await pause(250);
  const held = await save("held-aim-before-retest");
  await page.evaluate(() => {
    window.autoEffectFrames = [];
  });
  await clickTV(page, "graphics:retest");
  await pause(500);
  assert.deepEqual(
    (await auto()).flags,
    held.automatic.flags,
    "Retest cannot change automatic effects during held aim",
  );
  send({ type: "roll", gesture: { x: 0.2, power: 0.6 } });
  await waitState((value) => value.rolling);
  await expect(table).toHaveAttribute("data-startup-rolling", "true");
  await pause(500);
  assert.deepEqual(
    (await auto()).flags,
    held.automatic.flags,
    "airborne dice cannot trigger automatic effect changes",
  );
  const settled = await waitState(
    (value) => !value.rolling && !!value.lastRoll,
  );
  const flight = await page.evaluate(() =>
    window.autoEffectFrames.filter((frame) => frame.rolling === "true"),
  );
  assert(flight.length >= 2);
  assert(flight.at(-1).at - flight[0].at >= 400);
  assert(
    new Set(flight.map((frame) => JSON.stringify(frame.dice))).size >= 2,
    "actual moving dice are observed during the qualification pause",
  );
  assert.equal(
    new Set(flight.map(resourceSignature)).size,
    1,
    "no automatic flags, probe captures, or resources change in real flight",
  );
  checks.push(
    "actual held aim and moving physics flight freeze automatic effects and resource changes during Retest",
  );
  await ready();
  await settledAutomatic();
  await save("safe-after-real-roll");
  assert.deepEqual(
    state,
    settled,
    "automatic qualification cannot change the real ledger",
  );

  await openEffects();
  for (const key of keys) await chooseEffect(key, "off");
  await expect(table).toHaveAttribute("data-lens-flare-resources", "0");
  await expect(table).toHaveAttribute("data-contact-shadows", "false");
  await expect
    .poll(
      async () =>
        JSON.parse(await table.getAttribute("data-local-reflections"))
          .estimatedBytes,
    )
    .toBe(0);
  await clickTV(page, "graphics:retest");
  await pause(1000);
  for (const key of keys) assert.equal((await graphics())[key], "off");
  assert.deepEqual((await auto()).flags, {
    lensFlares: false,
    localReflections: false,
    contactShadows: false,
  });
  await ready();
  await pause(800);
  for (const key of keys) assert.equal((await graphics())[key], "off");
  await expect(table).toHaveAttribute("data-lens-flare-resources", "0");
  await expect(table).toHaveAttribute("data-contact-shadows", "false");
  assert.equal(
    JSON.parse(await table.getAttribute("data-local-reflections"))
      .estimatedBytes,
    0,
  );
  const stored = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("crapstv-graphics-v1")),
  );
  for (const key of keys) assert.equal(stored[key], "off");
  await save("manual-off-preserved-after-retest");
  checks.push(
    "explicit manual Off remains saved and allocation-free through Retest",
  );
  assert.deepEqual(state, settled);
  assert.deepEqual(errors, []);
  assert.deepEqual(glErrors, []);
  await mkdir(folder, { recursive: true });
  await page.screenshot({ path: `${folder}/settings.png` });
  const report = {
    ok: true,
    viewport,
    software,
    checks,
    snapshots,
    flightFrames: flight.length,
    flightSpanMs: flight.at(-1).at - flight[0].at,
    errors,
    glErrors,
  };
  await writeFile(
    `${folder}/report.json`,
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  await mkdir(folder, { recursive: true });
  await page?.screenshot({ path: `${folder}/failure.png` }).catch(() => {});
  await writeFile(
    `${folder}/failure.json`,
    JSON.stringify(
      {
        message: error.stack || error.message,
        snapshots,
        errors,
        glErrors,
        serverLog,
        frames: await page
          ?.evaluate(() => window.autoEffectFrames)
          .catch(() => []),
      },
      null,
      2,
    ) + "\n",
  );
  throw error;
} finally {
  ws?.terminate();
  await browser?.close();
  server.kill("SIGTERM");
}
