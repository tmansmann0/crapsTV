import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { chromium } from "@playwright/test";
import { PerspectiveCamera, Vector3 } from "three";

const root = fileURLToPath(new URL("../", import.meta.url));
const width = Number(process.env.TOUR_WIDTH || (process.env.CI ? 960 : 1280)),
  height = Number(process.env.TOUR_HEIGHT || (process.env.CI ? 640 : 800));
const resolution = process.env.CI && !process.env.TOUR_WIDTH ? "75" : "100";
const artifactPrefix = `tour-${width}x${height}`;
const captureLabels = new Set(
  (process.env.TOUR_CAPTURE_LABELS || "").split(",").filter(Boolean),
);
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
    samples = [],
    expectedLedgers = new Map();
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
      throwId: element.dataset.throwId,
      position: JSON.parse(element.dataset.cameraPosition),
      target: JSON.parse(element.dataset.cameraTarget),
      fov: Number(element.dataset.cameraFov),
      variant: element.dataset.cameraVariant,
      arrivalAt:
        element.dataset.cameraArrivalAt === ""
          ? null
          : Number(element.dataset.cameraArrivalAt),
      transferAt:
        element.dataset.cameraTransferAt === ""
          ? null
          : Number(element.dataset.cameraTransferAt),
      subjectHeight: Number(element.dataset.cameraSubjectHeight),
      transfers: JSON.parse(element.dataset.activeTransfers),
      bankCount: Number(element.dataset.banks),
      manual: element.dataset.cameraManual,
      sceneResolution: element.dataset.sceneResolution,
      uiResolution: element.dataset.uiResolution,
      fps: Number(element.dataset.renderFps || 0),
    }));
  }
  async function capture(
    label,
    phase,
    playerId = null,
    flowIds = [],
    playerCount = 12,
  ) {
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
    const directed = phase.startsWith("outcome") || phase.startsWith("idle");
    if (phase === "betting" || directed)
      await page.waitForFunction(
        (directed) => {
          const data = document.querySelector(".table-canvas").dataset;
          const actual = JSON.parse(data.cameraPosition);
          const expected = window.tourQA.metadata().expectedCamera;
          return (
            Math.hypot(
              ...actual.map((value, axis) => value - expected.position[axis]),
            ) < (directed ? 0.0001 : 0.015) &&
            (!directed ||
              Math.abs(Number(data.cameraFov) - expected.fov) < 0.0001)
          );
        },
        directed,
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
    await page.evaluate(() => window.tourQA.prepareQR());
    await page.waitForFunction(() => window.tourQA.qrMatches(), null, {
      timeout: renderTimeout,
    });
    // CI exercises the actual scene and dataset assertions, while local runs
    // retain full framebuffer proofs without costly software-GPU readbacks.
    if (
      (!process.env.CI || process.env.TOUR_CAPTURE === "1") &&
      (!captureLabels.size || captureLabels.has(label))
    )
      await page.screenshot({
        path: `${root}/artifacts/${artifactPrefix}-${label}.png`,
      });
    const meta = await page.evaluate(() => window.tourQA.metadata());
    assert.equal(
      meta.state.players.filter((player) => !player.left).length,
      playerCount,
    );
    if (phase.startsWith("outcome") || phase.startsWith("idle")) {
      for (const key of ["position", "target"])
        assert(
          Math.hypot(
            ...actual[key].map(
              (value, axis) => value - meta.expectedCamera[key][axis],
            ),
          ) < 0.0001,
          `${label}: actual ${key} is already at the planned camera pose`,
        );
      assert(
        Math.abs(actual.fov - meta.expectedCamera.fov) < 0.0001,
        `${label}: actual lens matches the planned shot`,
      );
      assert.equal(actual.variant, meta.expectedCamera.shotVariant);
      const projected = new PerspectiveCamera(
        actual.fov,
        width / height,
        0.035,
        160,
      );
      projected.position.fromArray(actual.position);
      projected.lookAt(new Vector3(...actual.target));
      projected.updateMatrixWorld(true);
      for (const focus of meta.expectedCamera.focusPoints || []) {
        const point = new Vector3(...focus).project(projected);
        assert(
          Math.abs(point.x) < 1 &&
            Math.abs(point.y) < 1 &&
            point.z > -1 &&
            point.z < 1,
          `${label}: the actual camera contains the selected chip bounds`,
        );
      }
    }
    if (expectedLedgers.has(meta.scenarioId))
      assert.deepEqual(
        meta.ledger,
        expectedLedgers.get(meta.scenarioId),
        `${label}: presentation leaves the ledger unchanged`,
      );
    samples.push({
      label,
      actual,
      now: meta.now,
      ledger: meta.ledger,
      scenarioId: meta.scenarioId,
      renderedWagers: meta.renderedWagers,
    });
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
    settled.state.throw?.frames?.length > 0,
    "a genuine physical timeline is retained",
  );
  assert.deepEqual(
    settled.state.lastRoll.dice,
    settled.state.throw.dice,
    "the natural resting faces settle the game without an override",
  );
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
  expectedLedgers.set(settled.scenarioId, expectedLedger);
  const phaseKeys = new Set();
  const heroSequence = [];
  for (const [index, slot] of settled.plan.slots.entries()) {
    assert(
      slot.transferAt > slot.startAt,
      "each payout budgets a visible camera preparation interval",
    );
    const prepared = await page.evaluate(
      (at) => window.tourQA.seek(at),
      slot.startAt + (slot.transferAt - slot.startAt) * 0.5,
    );
    const arrived = await capture(
      `arrival-${index + 1}`,
      prepared.expectedCamera.phase,
      prepared.expectedCamera.playerId,
    );
    assert.equal(arrived.arrivalAt, slot.arrivalAt ?? slot.startAt);
    assert.equal(arrived.transferAt, slot.transferAt);
    assert.deepEqual(
      arrived.transfers,
      [],
      "camera is in place while the chips are still held",
    );
    if (index === 0) {
      heroSequence.push({ progress: 0, camera: arrived });
      const early = await page.evaluate(
        (at) => window.tourQA.seek(at),
        slot.transferAt + slot.flightMs * 0.08,
      );
      const earlyCamera = await capture(
        "hero-early-flight",
        early.expectedCamera.phase,
        early.expectedCamera.playerId,
        settled.plan.transfers
          .filter((flow) => slot.playerIds.includes(flow.playerId))
          .map((flow) => flow.id),
      );
      heroSequence.push({ progress: 0.08, camera: earlyCamera });
    }
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
    assert.equal(
      actual.shotKey,
      arrived.shotKey,
      "flight begins inside the already established shot",
    );
    if (index === 0) {
      heroSequence.push({ progress: 0.5, camera: actual });
      for (const progress of [0.82, 0.995]) {
        const moved = await page.evaluate(
          (at) => window.tourQA.seek(at),
          slot.transferAt + slot.flightMs * progress,
        );
        const frame = await capture(
          `hero-flight-${progress}`,
          moved.expectedCamera.phase,
          moved.expectedCamera.playerId,
          settled.plan.transfers
            .filter((flow) => slot.playerIds.includes(flow.playerId))
            .map((flow) => flow.id),
        );
        heroSequence.push({ progress, camera: frame });
      }
      const tailAt = Math.min(
        slot.endAt - 1,
        slot.transferAt + slot.flightMs + 30,
      );
      const tail = await page.evaluate((at) => window.tourQA.seek(at), tailAt);
      const banked = await capture(
        "hero-bank-arrival-tail",
        tail.expectedCamera.phase,
        tail.expectedCamera.playerId,
      );
      heroSequence.push({ progress: 1, camera: banked });
      assert.deepEqual(
        banked.transfers,
        [],
        "the bank has received the chips before the shot's tail ends",
      );
      for (let step = 1; step < heroSequence.length; step++) {
        const previous = heroSequence[step - 1].camera,
          current = heroSequence[step].camera;
        const direction = (frame) => {
          const vector = frame.position.map(
            (value, axis) => value - frame.target[axis],
          );
          const length = Math.hypot(...vector);
          return { vector: vector.map((value) => value / length), length };
        };
        const a = direction(previous),
          b = direction(current);
        const turn =
          (Math.acos(
            Math.max(
              -1,
              Math.min(
                1,
                a.vector.reduce(
                  (sum, value, axis) => sum + value * b.vector[axis],
                  0,
                ),
              ),
            ),
          ) *
            180) /
          Math.PI;
        assert(
          turn < 35,
          "a payout shot retains its heading without an abrupt reverse angle",
        );
        assert(
          Math.max(a.length, b.length) / Math.min(a.length, b.length) < 1.6,
          "the close payout shot has no sudden wide/macro distance jump",
        );
        assert.equal(current.shotKey, arrived.shotKey);
      }
    }
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
      actual.position[1] > actual.target[1] + 0.2,
      "finite bank visits look down onto the actual chip faces",
    );
    assert(
      Math.hypot(
        ...actual.position.map((value, axis) => value - actual.target[axis]),
      ) < 3.6,
      "bank visits remain close to the player's physical inventory",
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
  const shortProofs = [];
  for (const seconds of [0, 1, 2]) {
    const short = await page.evaluate(
      (seconds) => window.tourQA.shortScenario(seconds),
      seconds,
    );
    expectedLedgers.set(short.scenarioId, short.ledger);
    assert(short.state.throw?.frames?.length > 0);
    assert.deepEqual(short.state.lastRoll.dice, short.state.throw.dice);
    assert.equal(
      short.state.nextRollAt,
      short.state.lastRoll.at + seconds * 1000,
      "camera direction never lengthens the admin's fixed cooldown",
    );
    if (seconds === 0) {
      assert.equal(short.plan.mode, "immediate");
      assert.deepEqual(
        short.plan.slots,
        [],
        "zero cooldown keeps immediate settlement with no tour",
      );
      await page.evaluate(
        (at) => window.tourQA.seek(at),
        short.state.lastRoll.at + 1,
      );
      await page.waitForFunction(
        (id) => document.querySelector(".table-canvas")?.dataset.throwId === id,
        short.state.throw.id,
        { timeout: renderTimeout },
      );
      assert.equal(
        (await read()).phase,
        "result",
        "zero cooldown retains its unextended result view",
      );
      shortProofs.push({ seconds, plan: short.plan, state: short.state });
      continue;
    }
    const slot = short.plan.slots[0];
    assert(slot && short.plan.endAt <= short.state.nextRollAt);
    assert(
      slot.transferAt > slot.startAt,
      "a short window still reserves camera preparation time",
    );
    assert(
      slot.startAt < short.state.throw.settledAt + 1600,
      "this real physical scenario overlaps the ordinary result-camera hold",
    );
    const prepared = await page.evaluate(
      (at) => window.tourQA.seek(at),
      slot.startAt + (slot.transferAt - slot.startAt) * 0.5,
    );
    const arrival = await capture(
      `short-${seconds}s-arrival`,
      prepared.expectedCamera.phase,
      prepared.expectedCamera.playerId,
    );
    assert(
      arrival.phase.startsWith("outcome"),
      "outcome preparation takes priority over the lingering result camera",
    );
    assert.equal(arrival.arrivalAt, slot.arrivalAt ?? slot.startAt);
    assert.equal(arrival.transferAt, slot.transferAt);
    assert.deepEqual(
      arrival.transfers,
      [],
      "the camera arrives while source chips remain held",
    );
    const activeAt = slot.transferAt + slot.flightMs * 0.45;
    const active = await page.evaluate(
      (at) => window.tourQA.seek(at),
      activeAt,
    );
    const flightIds = short.plan.transfers.map((flow) => flow.id);
    const flying = await capture(
      `short-${seconds}s-flight`,
      active.expectedCamera.phase,
      active.expectedCamera.playerId,
      flightIds,
    );
    assert.equal(flying.shotKey, arrival.shotKey);
    assert.deepEqual(
      flying.transfers.map((flow) => flow.id).sort(),
      [...flightIds].sort(),
    );
    assert(
      short.plan.transfers.every(
        (flow) => flow.startAt + flow.duration <= short.state.nextRollAt,
      ),
    );
    shortProofs.push({ seconds, arrival, flying, plan: short.plan });

    if (seconds === 2) {
      await page.emulateMedia({ reducedMotion: "reduce" });
      const reduced = await page.evaluate(() => window.tourQA.metadata());
      assert.equal(reduced.expectedCamera.phase, "betting");
      await capture("reduced-motion", "betting", null, flightIds);
      await page.emulateMedia({ reducedMotion: "no-preference" });
      const x = width * 0.5,
        y = height * 0.48;
      await page.mouse.move(x, y);
      await page.keyboard.down("Shift");
      await page.mouse.down();
      await page.waitForFunction(
        () =>
          document.querySelector(".table-canvas")?.dataset.cameraManual ===
          "true",
      );
      await page.mouse.move(x + width * 0.06, y, { steps: 5 });
      await page.mouse.up();
      await page.keyboard.up("Shift");
      const manuallyHeld = await read();
      assert.equal(
        manuallyHeld.manual,
        "true",
        "a manual pan overrides the payout director",
      );
      assert.deepEqual(
        (await page.evaluate(() => window.tourQA.metadata())).ledger,
        short.ledger,
      );
      await page.evaluate(() => window.tourQA.resumeAuto());
      await page.waitForFunction(
        () =>
          document.querySelector(".table-canvas")?.dataset.cameraManual ===
          "false",
      );
    }
  }

  const detailCases = await page.evaluate(() => window.tourQA.prepareDetails());
  assert.equal(
    detailCases.length,
    6,
    "all six chip camera variations have real active subjects",
  );
  assert.equal(
    new Set(detailCases.map((detail) => detail.camera.shotVariant)).size,
    6,
  );
  const detailProofs = [];
  const angleOf = (camera) =>
    (Math.atan2(
      camera.position[1] - camera.target[1],
      Math.hypot(
        camera.position[0] - camera.target[0],
        camera.position[2] - camera.target[2],
      ),
    ) *
      180) /
    Math.PI;
  for (const detail of detailCases) {
    const selected = await page.evaluate(
      (index) => window.tourQA.selectDetail(index),
      detail.index,
    );
    expectedLedgers.set(selected.scenarioId, selected.ledger);
    const actual = await capture(
      `detail-${detail.camera.shotVariant}`,
      "idle-player",
      selected.expectedCamera.playerId,
      [],
      detail.playerCount,
    );
    const visibleWagers = (await page.evaluate(() => window.tourQA.metadata()))
      .renderedWagers;
    assert.equal(
      visibleWagers.chipCount,
      8,
      "the actual scene contains eight wager-chip instances",
    );
    assert(
      visibleWagers.visibleInstances >= 8,
      "the actual visible model buffers contain the stack",
    );
    assert.deepEqual(
      visibleWagers.piles.map((pile) => pile.amount),
      [19400],
    );
    const distance = Math.hypot(
      ...actual.position.map((value, axis) => value - actual.target[axis]),
    );
    if (detail.camera.shotVariant === "bank-macro")
      assert(distance < 2.5, "engraved bank faces receive a close macro view");
    if (detail.camera.shotVariant.startsWith("bet-")) {
      assert(
        detail.wager?.chipCount === 8 && detail.wager.height > 0.4,
        "the subject is a physically tall eight-chip pile",
      );
      assert(
        Math.abs(actual.subjectHeight - detail.wager.height) < 0.0001,
        "camera height metadata uses the actual rendered/colliding stack",
      );
      assert(
        angleOf(actual) > 50,
        "a tall pile lifts the camera and reveals its top face",
      );
    }
    if (detail.camera.shotVariant.endsWith("overhead"))
      assert(
        angleOf(actual) > 80,
        "overhead variants look down onto chip faces",
      );
    detailProofs.push({ detail, actual, angle: angleOf(actual), distance });
  }
  const tallDetail = detailCases.find(
    (detail) => detail.camera.shotVariant === "bet-low-glide",
  );
  assert(tallDetail);
  const thinDetail = await page.evaluate(
    (index) => window.tourQA.prepareThinCompanion(index),
    tallDetail.index,
  );
  const thin = await page.evaluate(
    (index) => window.tourQA.selectDetail(index),
    thinDetail.index,
  );
  expectedLedgers.set(thin.scenarioId, thin.ledger);
  const thinActual = await capture(
    "detail-thin-comparison",
    "idle-player",
    thin.expectedCamera.playerId,
    [],
    thinDetail.playerCount,
  );
  const thinVisible = (await page.evaluate(() => window.tourQA.metadata()))
    .renderedWagers;
  assert.equal(
    thinVisible.chipCount,
    1,
    "the actual thin scene contains exactly one wager chip",
  );
  assert(thinVisible.visibleInstances >= 1);
  assert.deepEqual(
    thinVisible.piles.map((pile) => pile.amount),
    [50000],
  );
  const tallActual = detailProofs.find(
    (detail) => detail.detail.index === tallDetail.index,
  ).actual;
  assert.equal(
    thinActual.variant,
    tallActual.variant,
    "height comparison uses the same angle variation",
  );
  assert(thinDetail.wager.chipCount === 1);
  assert(
    tallActual.position[1] > thinActual.position[1] + 0.2,
    "the tall pile gets a physically higher camera than one chip",
  );
  assert(
    angleOf(tallActual) > angleOf(thinActual) + 15,
    "the tall pile gets a materially steeper down-looking angle",
  );

  for (const sample of samples.slice(1))
    if (sample.scenarioId === settled.scenarioId)
      assert.deepEqual(
        sample.ledger,
        expectedLedger,
        `${sample.label}: original settled ledger stays unchanged`,
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
        shortProofs,
        detailProofs,
        heroSequence,
        thinDetail,
        samples,
        errors,
      },
      null,
      2,
    ),
  );
  console.log(
    "Tour proof passed: real throw, preflight camera arrival at fixed 0/1/2s cooldowns, hero/pair/group continuity, six close variants, height-aware stack detail, manual/reduced-motion behavior and finite idle visits; settled ledger unchanged.",
  );
} finally {
  await browser?.close();
  await server.close();
}
