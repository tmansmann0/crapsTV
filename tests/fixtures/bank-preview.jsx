import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { Scene, Matrix4 } from "three";
import Table3D from "../../src/Table3D.jsx";
import * as game from "../../src/game.js";
import "../../src/style.css";

let banks,
  transfers,
  publish,
  clock = 100000,
  seed = 0;
const add = Scene.prototype.add;
Scene.prototype.add = function (...objects) {
  objects.forEach((object) => {
    if (object.name === "Player bankrolls") banks = object;
    if (object.name === "Chip transfers") transfers = object;
  });
  return add.apply(this, objects);
};
Date.now = () => clock;
Object.defineProperty(crypto, "getRandomValues", {
  value: (values) => {
    values.fill(++seed);
    return values;
  },
});
localStorage.setItem(
  "crapstv-graphics-v1",
  JSON.stringify({
    fps: 60,
    antialias: "on",
    resolution: "100",
    modelDetail: window.bankFixtureSoftware ? "optimized" : "auto",
    textures: window.bankFixtureSoftware ? "1k" : "2k",
    lensFlares: "off",
    localReflections: "off",
    contactShadows: "off",
  }),
);
const state = game.createState("BANKQA");
let player = game.join(state, "Alex");
game.setRollCooldown(state, state.adminId, 0);
game.start(state, state.adminId);
state.clockOffsetMs = 0;
const snapshot = () => ({ ...structuredClone(state), snapshotAt: clock });
const update = () => publish(snapshot());
window.bankQA = {
  metadata() {
    const specs = Object.values(banks?.userData.layouts || {}).flat();
    const batch = banks?.children.find((group) => group.userData.chipBatch)
      ?.userData.chipBatch;
    const matrix = new Matrix4();
    return {
      now: clock,
      bank: player.bank,
      bets: structuredClone(player.bets),
      chips: specs.map((spec, index) => {
        batch.getMatrixAt(index, matrix);
        return { ...spec, matrix: matrix.toArray() };
      }),
      flights: (transfers?.children || [])
        .filter((group) => group.userData.flow)
        .map((group) => ({
          flow: group.userData.flow,
          chips: group.userData.flightSpecs,
        })),
    };
  },
  seek(now) {
    clock = now;
    update();
  },
  bet(amount) {
    clock += 1000;
    game.place(state, player.id, "pass", amount);
    update();
    return clock;
  },
  credit(amount) {
    // An isolated fixture award exercises the production transfer planner and
    // renderer's bounded capacity management without a user room or rigged die.
    clock += 1500;
    player.bank += amount;
    update();
    return clock;
  },
  win() {
    for (let value = 1; value <= 128; value++) {
      const candidate = structuredClone(state);
      seed = value - 1;
      const timeline = game.beginRoll(candidate, player.id, { x: 0, power: 0 });
      if (timeline.dice[0] + timeline.dice[1] !== 7) continue;
      Object.assign(state, candidate);
      player = state.players.find((p) => p.id === player.id);
      clock += timeline.duration;
      game.setRollCooldown(state, state.adminId, 10);
      game.finishRoll(state);
      update();
      return structuredClone(state.lastRoll.presentation);
    }
    throw Error("Fixture could not find a natural seven");
  },
};
function App() {
  const [current, setCurrent] = useState(snapshot());
  publish = setCurrent;
  return (
    <div style={{ position: "fixed", inset: 0 }}>
      <Table3D
        state={current}
        code={state.code}
        status="connected"
        joinURL="http://bank-fixture.local/join"
        onAction={() => {}}
      />
    </div>
  );
}
createRoot(document.getElementById("root")).render(<App />);
