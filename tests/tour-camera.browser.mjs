import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { chromium } from "@playwright/test";

const root = fileURLToPath(new URL("../", import.meta.url));
const width = Number(process.env.TOUR_WIDTH || (process.env.CI ? 960 : 1280)),
  height = Number(process.env.TOUR_HEIGHT || (process.env.CI ? 640 : 800));
const resolution = process.env.CI && !process.env.TOUR_WIDTH ? "75" : "100";
const artifactPrefix = `tour-${width}x${height}`;
const renderTimeout = process.env.CI ? 120000 : 60000;
assert(
  Number.isInteger(width) &&
    width > 0 &&
    Number.isInteger(height) &&
    height > 0,
);
const server = await createServer({
  configFile: false,
  root,
  logLevel: "error",
  esbuild: { jsx: "automatic" },
  server: { host: "127.0.0.1", port: 0 },
  optimizeDeps: {
    include: [
      "react",
      "react-dom/client",
      "react/jsx-runtime",
      "three",
      "cannon-es",
      "qrcode",
    ],
  },
});
await server.listen();
let browser;
try {
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
    viewport: { width, height },
    deviceScaleFactor: 1,
  });
  await page.addInitScript(
    ({ software, resolution }) => {
      window.tourFixtureSoftware = software;
      window.tourFixtureResolution = resolution;
    },
    { software: !!process.env.CI, resolution },
  );
  const errors = [],
    samples = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/__tour-preview", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<html><body style="margin:0"><div id="root"></div><script type="module" src="/tests/fixtures/tour-preview.jsx"></script></body></html>',
    }),
  );
  await page.goto(
    `http://127.0.0.1:${server.httpServer.address().port}/__tour-preview`,
  );
  await page.waitForFunction(
    () =>
      document.querySelector(".table-canvas")?.dataset.sceneReady === "true",
    null,
    { timeout: renderTimeout },
  );
  await page.waitForFunction(
    () =>
      document.querySelector(".table-canvas")?.dataset.graphicsIntro ===
      "false",
    null,
    { timeout: 20000 },
  );
  await mkdir(`${root}/artifacts`, { recursive: true });
  async function read() {
    return page.locator(".table-canvas").evaluate((element) => ({
      phase: element.dataset.cameraShot,
      playerId: element.dataset.cameraPlayer,
      shotKey: element.dataset.cameraShotKey,
      position: JSON.parse(element.dataset.cameraPosition),
      target: JSON.parse(element.dataset.cameraTarget),
      transfers: JSON.parse(element.dataset.activeTransfers),
      bankCount: Number(element.dataset.banks),
      manual: element.dataset.cameraManual,
      sceneResolution: element.dataset.sceneResolution,
      uiResolution: element.dataset.uiResolution,
      fps: Number(element.dataset.renderFps || 0),
    }));
  }
  async function capture(label, phase, playerId = null, flowIds = []) {
    await page.waitForFunction(
      ({ phase, playerId, flowIds }) => {
        const data = document.querySelector(".table-canvas")?.dataset;
        return (
          data?.cameraShot === phase &&
          (!playerId || data.cameraPlayer === playerId) &&
          JSON.stringify(
            JSON.parse(data.activeTransfers || "[]")
              .map((flow) => flow.id)
              .sort(),
          ) === JSON.stringify([...flowIds].sort())
        );
      },
      { phase, playerId, flowIds },
      { timeout: 30000 },
    );
    if (phase === "betting")
      await page.waitForFunction(
        () => {
          const actual = JSON.parse(
            document.querySelector(".table-canvas").dataset.cameraPosition,
          );
          const expected = window.tourQA.metadata().expectedCamera.position;
          return (
            Math.hypot(...actual.map((value, axis) => value - expected[axis])) <
            0.015
          );
        },
        null,
        { timeout: renderTimeout },
      );
    const actual = await read();
    assert.equal(actual.manual, "false");
    assert(actual.bankCount > 0, "modeled bank inventory has rendered batches");
    assert.equal(
      actual.sceneResolution,
      `${Math.floor((width * Number(resolution)) / 100)}x${Math.floor((height * Number(resolution)) / 100)}`,
    );
    assert.equal(actual.uiResolution, `${width}x${height}`);
    // CI exercises the actual scene and dataset assertions, while local runs
    // retain full framebuffer proofs without costly software-GPU readbacks.
    if (!process.env.CI || process.env.TOUR_CAPTURE === "1")
      await page.screenshot({
        path: `${root}/artifacts/${artifactPrefix}-${label}.png`,
      });
    const meta = await page.evaluate(() => window.tourQA.metadata());
    assert.equal(
      meta.state.players.filter((player) => !player.left).length,
      12,
    );
    samples.push({ label, actual, now: meta.now, ledger: meta.ledger });
    return actual;
  }
  const initial = await capture("betting", "betting");
  const angle =
    (Math.atan2(
      initial.position[1] - initial.target[1],
      Math.hypot(
        initial.position[0] - initial.target[0],
        initial.position[2] - initial.target[2],
      ),
    ) *
      180) /
    Math.PI;
  assert(angle > 70, `betting camera is near top-down (${angle}°)`);
  const settled = await page.evaluate(() => window.tourQA.roll());
  assert.equal(settled.state.lastRoll.total, 7);
  assert(
    settled.plan.slots.some((slot) => slot.playerIds.length === 1),
    "standout gets an individual focus",
  );
  assert(
    settled.plan.slots.some((slot) => slot.playerIds.length === 2),
    "matching middle payouts get a pair focus",
  );
  assert(
    settled.plan.slots.some((slot) => slot.playerIds.length > 2),
    "remaining payouts are grouped",
  );
  assert.equal(settled.plan.slots.flatMap((slot) => slot.playerIds).length, 12);
  assert(settled.plan.endAt <= settled.state.nextRollAt);
  const expectedLedger = settled.ledger;
  const phaseKeys = new Set();
  for (const [index, slot] of settled.plan.slots.entries()) {
    const sought = await page.evaluate(
      (at) => window.tourQA.seek(at),
      slot.transferAt + slot.flightMs * 0.5,
    );
    const actual = await capture(
      `settlement-${index + 1}-${slot.kind}`,
      sought.expectedCamera.phase,
      sought.expectedCamera.playerId,
      settled.plan.transfers
        .filter((flow) => slot.playerIds.includes(flow.playerId))
        .map((flow) => flow.id),
    );
    phaseKeys.add(actual.shotKey);
    assert.deepEqual(
      actual.transfers.map((flow) => flow.playerId).sort(),
      [...slot.playerIds].sort(),
      "only the planned camera subjects' modeled chips are currently flying",
    );
    for (const flow of actual.transfers) {
      const planned = settled.plan.transfers.find(
        (candidate) => candidate.id === flow.id,
      );
      assert(planned);
      assert.equal(flow.kind, "win");
      assert.equal(flow.amount, planned.amount);
      assert.equal(
        flow.amount,
        settled.state.lastRoll.events.find(
          (event) => event.playerId === flow.playerId,
        ).bets[0].amount * 2,
        "profit plus returned stake flies to the bank",
      );
    }
  }
  assert.equal(
    phaseKeys.size,
    settled.plan.slots.length,
    "director changes focus with each scheduled group",
  );
  const postTour = await page.evaluate(() => window.tourQA.postTourSchedule());
  assert(
    postTour.visits.length > 0 && postTour.visits.length <= 3,
    "idle visitation is finite, rather than cycling indefinitely",
  );
  assert.equal(
    new Set(postTour.visits.map((visit) => visit.camera.playerId)).size,
    postTour.visits.length,
    "idle director visits each selected player only once",
  );
  const heroIds = new Set(
    settled.plan.slots
      .filter((slot) => slot.style === "hero")
      .flatMap((slot) => slot.playerIds),
  );
  assert(
    postTour.visits.every((visit) => !heroIds.has(visit.camera.playerId)),
    "idle pass does not repeat the just-featured hero",
  );
  for (const [index, visit] of postTour.visits.slice(0, 2).entries()) {
    const sought = await page.evaluate(
      (at) => window.tourQA.seek(at),
      visit.at,
    );
    const actual = await capture(
      `idle-${index + 1}`,
      sought.expectedCamera.phase,
      sought.expectedCamera.playerId,
    );
    assert(
      actual.position[1] >= 1 && actual.position[1] < 2,
      "idle camera is at seated/standing human table height",
    );
    assert.deepEqual(actual.transfers, []);
  }
  const held = await page.evaluate(
    (at) => window.tourQA.seek(at),
    postTour.heldAt,
  );
  assert.equal(held.expectedCamera.phase, "betting");
  const overheadA = await capture("held-overhead", "betting");
  const heldLater = await page.evaluate(
    (at) => window.tourQA.seek(at),
    postTour.heldAt + 30000,
  );
  const overheadB = await capture("still-overhead", "betting");
  assert.deepEqual(
    held.expectedCamera.position,
    heldLater.expectedCamera.position,
    "after the finite visit sequence, the camera stays over the board",
  );
  assert(
    Math.hypot(
      ...overheadA.position.map(
        (value, axis) => value - overheadB.position[axis],
      ),
    ) < 0.02,
    "rendered camera remains at the held overview after ordinary easing",
  );
  for (const sample of samples.slice(1))
    assert.deepEqual(
      sample.ledger,
      expectedLedger,
      `${sample.label}: camera and presentation never alter the settled ledger`,
    );
  assert.deepEqual(errors, []);
  await writeFile(
    `${root}/artifacts/${artifactPrefix}-qa.json`,
    JSON.stringify(
      {
        viewport: { width, height },
        requested: {
          resolution,
          modelDetail: process.env.CI ? "optimized" : "auto",
          textures: process.env.CI ? "1k" : "2k",
        },
        settled,
        samples,
        errors,
      },
      null,
      2,
    ),
  );
  console.log(
    "Tour proof passed: top-down, plan-driven hero/pair/group payout shots, finite human-height idle visits then held overhead; settled ledger unchanged.",
  );
} finally {
  await browser?.close();
  await server.close();
}
