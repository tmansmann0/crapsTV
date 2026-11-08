import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import Table3D from "../../src/Table3D.jsx";
import * as game from "../../src/game.js";
import {
  sampleTableCamera,
  IDLE_OVERVIEW_MS,
  IDLE_PLAYER_SHOT_MS,
} from "../../src/throw-camera.js";
import { wagerStackLayout } from "../../src/wager-layout.js";
import { Scene } from "three";
import QRCode from "qrcode";
import { JOIN_CARD } from "../../src/tv-layout.js";
import "../../src/style.css";

// Read actual scene resources from the fixture, without adding a product debug
// API or replacing any geometry, rendering, camera or material behavior.
let renderedWagers,
  renderedBanks,
  joinPanel,
  uploadedJoinVersion = -1,
  expectedQR;
const addToScene = Scene.prototype.add;
Scene.prototype.add = function (...objects) {
  for (const object of objects) {
    if (object.name === "Live wagers") renderedWagers = object;
    if (object.name === "Player bankrolls") renderedBanks = object;
    if (object.userData?.id === "join") {
      joinPanel = object;
      const texture = object.material.map;
      const previous = texture.onUpdate;
      texture.onUpdate = (...args) => {
        uploadedJoinVersion = texture.version;
        previous?.(...args);
      };
    }
  }
  return addToScene.apply(this, objects);
};

// An isolated authority and clock: never connects to a running table. UUIDs,
// throw seed and rules result are reproducible, while camera/chips use the real
// production renderer and serialized settlement plan without pose overrides.
let clock = 100000,
  sequence = 0,
  throwSeed = 3,
  scenario = 0;
Date.now = () => clock;
Object.defineProperty(crypto, "randomUUID", {
  value: () =>
    `00000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`,
});
Object.defineProperty(crypto, "getRandomValues", {
  value: (values) => {
    values.fill(++throwSeed);
    return values;
  },
});
localStorage.setItem("crapstv-tv-ui-size-v1", "compact");
localStorage.setItem("crapstv-tv-labels-v1", "smooth");
localStorage.setItem(
  "crapstv-graphics-v1",
  JSON.stringify({
    fps: 60,
    antialias: "on",
    resolution: window.tourFixtureResolution || "100",
    modelDetail: window.tourFixtureSoftware ? "optimized" : "auto",
    textures: window.tourFixtureSoftware ? "1k" : "2k",
  }),
);

const names = [
  "Alex",
  "Blair",
  "Casey",
  "Drew",
  "Elliot",
  "Frankie",
  "Gray",
  "Harper",
  "Indy",
  "Jordan",
  "Kai",
  "Lee",
];
const stakes = [50000, 10000, 10000, ...Array(9).fill(2500)];
function makeState({
  count = 12,
  onlySeat = null,
  stake = 19400,
  prefix = "T",
} = {}) {
  clock += 100000;
  const next = game.createState(
    `${prefix}${String(++scenario).padStart(5, "0")}`,
  );
  const players = names.slice(0, count).map((name) => game.join(next, name));
  game.setRollCooldown(next, next.adminId, 0);
  game.start(next, next.adminId);
  for (const [index, player] of players.entries())
    if (onlySeat === null || index === onlySeat)
      game.place(
        next,
        player.id,
        "pass",
        onlySeat === null ? stakes[index] : stake,
      );
  next.clockOffsetMs = 0;
  return next;
}
let state = makeState();
let publish;
const detailCases = [];
const ledger = () =>
  state.players.map(({ id, bank, bets }) => ({
    id,
    bank,
    bets: structuredClone(bets),
  }));
const snapshot = () => ({ ...structuredClone(state), snapshotAt: clock });
const cameraOptions = () => {
  const data = document.querySelector(".table-canvas")?.dataset;
  const panels = JSON.parse(data?.uiTextMetrics || "{}");
  return {
    aspect: innerWidth / innerHeight,
    viewportWidth: innerWidth,
    viewportHeight: innerHeight,
    hudRects: Object.values(panels).filter((panel) => panel.visible),
    reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
  };
};
const update = () => {
  publish(snapshot());
  return metadata();
};
const metadata = () => ({
  now: clock,
  scenarioId: `${state.code}:${state.createdAt}`,
  state: snapshot(),
  ledger: ledger(),
  physicalWagers: wagerStackLayout(state),
  renderedWagers: {
    chipCount: (renderedWagers?.children || []).reduce(
      (sum, child) => sum + (child.userData.chipBatch?.count || 0),
      0,
    ),
    visibleInstances: (renderedWagers?.children || [])
      .flatMap((child) => child.children || [])
      .filter((mesh) => mesh.isInstancedMesh && mesh.visible)
      .reduce((sum, mesh) => sum + mesh.count, 0),
    piles: (renderedWagers?.children || [])
      .filter((child) => child.userData.betId)
      .map((child) => ({ ...child.userData })),
  },
  plan: structuredClone(state.lastRoll?.presentation || null),
  expectedCamera: sampleTableCamera({
    state: { ...state, bankLayouts: renderedBanks?.userData.layouts || {} },
    now: clock,
    ...cameraOptions(),
  }),
});
window.tourQA = {
  metadata,
  roll(cooldownSeconds = 10) {
    // This is a fixture seed search, never a production outcome-selection path.
    // Keep the naturally settled recorded timeline instead of overriding its
    // faces, so the real result camera participates in every handoff proof.
    const before = structuredClone(state);
    let accepted;
    for (let seed = 1; seed <= 128; seed++) {
      const candidate = structuredClone(before);
      throwSeed = seed - 1;
      const timeline = game.beginRoll(candidate, candidate.shooterId, {
        x: 0,
        power: 0,
      });
      if (timeline.dice[0] + timeline.dice[1] === 7) {
        accepted = candidate;
        break;
      }
    }
    if (!accepted)
      throw new Error("No naturally settled seven in the fixture seed range");
    state = accepted;
    clock += state.throw.duration;
    game.setRollCooldown(state, state.adminId, cooldownSeconds);
    game.finishRoll(state);
    return update();
  },
  shortScenario(seconds) {
    state = makeState({ prefix: "S" });
    return this.roll(seconds);
  },
  seek(at) {
    clock = at;
    return update();
  },
  resumeAuto() {
    game.setDisplaySettings(state, state.adminId, { camera: "auto" });
    return update();
  },
  prepareDetails() {
    detailCases.length = 0;
    const found = new Set();
    for (let attempt = 0; attempt < 192 && found.size < 6; attempt++) {
      const seat = [0, 3, 6, 9, 11][attempt % 5];
      const next = makeState({ count: seat + 1, onlySeat: seat, prefix: "D" });
      const at =
        next.bettingOpenedAt + IDLE_OVERVIEW_MS + IDLE_PLAYER_SHOT_MS * 0.35;
      const camera = sampleTableCamera({
        state: next,
        now: at,
        ...cameraOptions(),
      });
      if (!camera.shotVariant || found.has(camera.shotVariant)) continue;
      found.add(camera.shotVariant);
      detailCases.push({
        state: structuredClone(next),
        at,
        camera,
        playerCount: seat + 1,
      });
    }
    return detailCases.map(
      ({ state: next, at, camera, playerCount }, index) => ({
        index,
        at,
        camera,
        playerCount,
        code: next.code,
        wager: wagerStackLayout(next).find(
          (pile) => pile.playerId === camera.playerId,
        ),
      }),
    );
  },
  prepareThinCompanion(index) {
    const selected = detailCases[index];
    if (!selected?.camera.shotVariant.startsWith("bet-"))
      throw new Error("A bet detail is required for the height comparison");
    const next = structuredClone(selected.state);
    const player = next.players.find((p) => p.id === selected.camera.playerId);
    clock = next.bettingOpenedAt;
    game.remove(next, player.id, player.bets[0].id);
    game.place(next, player.id, "pass", 50000); // One physical $500 chip.
    // A distinct isolated authority baseline clears bet-change flights. Keep
    // code/opening time/player IDs so the camera's deterministic variant and
    // heading remain identical to the tall case.
    next.createdAt -= 1;
    const camera = sampleTableCamera({
      state: next,
      now: selected.at,
      ...cameraOptions(),
    });
    const companion = { ...selected, state: next, camera };
    detailCases.push(companion);
    return {
      index: detailCases.length - 1,
      at: selected.at,
      camera,
      playerCount: selected.playerCount,
      wager: wagerStackLayout(next).find(
        (pile) => pile.playerId === camera.playerId,
      ),
    };
  },
  selectDetail(index) {
    const selected = detailCases[index];
    if (!selected) throw new Error("Unknown detail proof");
    state = structuredClone(selected.state);
    clock = selected.at;
    return update();
  },
  async prepareQR() {
    const url = `http://tour-fixture.local:3000/join?code=${state.code}`;
    const canvas = joinPanel?.material.map.image;
    const metrics = JSON.parse(
      document.querySelector(".table-canvas")?.dataset.uiTextMetrics || "{}",
    ).join;
    if (!canvas || !metrics) return false;
    if (
      expectedQR?.url === url &&
      expectedQR.width === canvas.width &&
      expectedQR.height === canvas.height
    )
      return true;
    const source = document.createElement("canvas");
    await QRCode.toCanvas(source, url, {
      margin: 1,
      width: 512,
      color: { dark: "#091914", light: "#f0e7d6" },
    });
    const expected = document.createElement("canvas");
    expected.width = canvas.width;
    expected.height = canvas.height;
    const context = expected.getContext("2d"),
      scale = metrics.backingScale;
    context.setTransform(scale, 0, 0, scale, 0, 0);
    context.imageSmoothingEnabled = false;
    context.drawImage(
      source,
      JOIN_CARD.qr.x,
      JOIN_CARD.qr.y,
      JOIN_CARD.qr.size,
      JOIN_CARD.qr.size,
    );
    const x = Math.ceil(JOIN_CARD.qr.x * scale) + 2,
      y = Math.ceil(JOIN_CARD.qr.y * scale) + 2;
    const size = Math.floor(JOIN_CARD.qr.size * scale) - 4;
    expectedQR = {
      url,
      width: canvas.width,
      height: canvas.height,
      x,
      y,
      size,
      pixels: context.getImageData(x, y, size, size).data,
    };
    return true;
  },
  qrMatches() {
    const texture = joinPanel?.material.map,
      canvas = texture?.image;
    if (!canvas || !expectedQR || uploadedJoinVersion !== texture.version)
      return false;
    const { x, y, size, pixels } = expectedQR;
    const actual = canvas.getContext("2d").getImageData(x, y, size, size).data;
    // Sample throughout the entire square, including all finder regions; a
    // half-uploaded or stale QR cannot pass by matching one strip.
    for (let i = 0; i < pixels.length; i += 4 * 7)
      if (
        actual[i] !== pixels[i] ||
        actual[i + 1] !== pixels[i + 1] ||
        actual[i + 2] !== pixels[i + 2]
      )
        return false;
    return true;
  },
  postTourSchedule() {
    const origin = Math.max(
      state.lastRoll.presentation.endAt,
      state.nextRollAt,
    );
    const visits = [],
      keys = new Set();
    for (let at = origin; at <= origin + 60000; at += 250) {
      const camera = sampleTableCamera({ state, now: at, ...cameraOptions() });
      if (camera.phase.startsWith("idle") && !keys.has(camera.shotKey)) {
        keys.add(camera.shotKey);
        visits.push({ at: at + 500, camera });
      }
    }
    return { visits, heldAt: origin + 120000 };
  },
};
function App() {
  const [current, setCurrent] = useState(snapshot());
  publish = setCurrent;
  return (
    <div style={{ position: "fixed", inset: 0 }}>
      <Table3D
        state={current}
        code={current.code}
        status="connected"
        joinURL={`http://tour-fixture.local:3000/join?code=${current.code}`}
        onAction={() => {}}
      />
    </div>
  );
}
createRoot(document.getElementById("root")).render(<App />);
