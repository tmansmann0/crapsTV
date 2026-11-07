import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import Table3D from "../../src/Table3D.jsx";
import * as game from "../../src/game.js";
import { sampleTableCamera } from "../../src/throw-camera.js";
import "../../src/style.css";

// An isolated authority and clock: never connects to a running table. UUIDs,
// throw seed and rules result are reproducible, while camera/chips use the real
// production renderer and serialized settlement plan without pose overrides.
let clock = 100000,
  sequence = 0,
  throwSeed = 3;
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

const state = game.createState("TOURQA");
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
const players = names.map((name) => game.join(state, name));
game.setRollCooldown(state, state.adminId, 0);
game.start(state, state.adminId);
const stakes = [50000, 10000, 10000, ...Array(9).fill(2500)];
for (const [index, player] of players.entries())
  game.place(state, player.id, "pass", stakes[index]);
state.clockOffsetMs = 0;
let publish;
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
  };
};
const update = () => {
  publish(snapshot());
  return metadata();
};
const metadata = () => ({
  now: clock,
  state: snapshot(),
  ledger: ledger(),
  plan: structuredClone(state.lastRoll?.presentation || null),
  expectedCamera: sampleTableCamera({ state, now: clock, ...cameraOptions() }),
});
window.tourQA = {
  metadata,
  roll() {
    const throwState = game.beginRoll(state, state.shooterId, {
      x: 0,
      power: 0,
    });
    clock += throwState.duration;
    game.setRollCooldown(state, state.adminId, 10);
    // Explicit result is the supported trusted rules-test API. finishRoll
    // discards the unrelated physical throw if its recorded faces differ.
    game.finishRoll(state, [3, 4]);
    return update();
  },
  seek(at) {
    clock = at;
    return update();
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
        joinURL="http://tour-fixture.local:3000/join?code=TOURQA"
        onAction={() => {}}
      />
    </div>
  );
}
createRoot(document.getElementById("root")).render(<App />);
