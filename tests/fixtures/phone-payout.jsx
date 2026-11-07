import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import PhoneGame from "../../src/PhoneGame.jsx";
import * as game from "../../src/game.js";
import "../../node_modules/@fontsource/dm-sans/latin-500.css";
import "../../node_modules/@fontsource/manrope/latin-800.css";
let state,
  playerId,
  refresh,
  generation = 0,
  connected = true;
function reset({ kind = "pass", history = false } = {}) {
  state = game.createState("PAYOUT");
  const player = game.join(state, "Payout Tester");
  playerId = player.id;
  game.configure(state, playerId, { rollCooldownSeconds: 0 }); // Immediate rolls for this isolated fixture.
  game.start(state, playerId);
  if (kind === "place-6") {
    game.beginRoll(state, playerId);
    game.finishRoll(state, [2, 2]);
  }
  if (kind === "odds") {
    game.place(state, playerId, "pass", 500);
    game.beginRoll(state, playerId);
    game.finishRoll(state, [2, 2]);
    game.place(state, playerId, `odds:${player.bets[0].id}`, 600);
  } else game.place(state, playerId, kind, kind === "place-6" ? 600 : 500);
  if (history) {
    game.beginRoll(state, playerId);
    game.finishRoll(state, [3, 4]);
  }
  state.snapshotAt = Date.now();
  generation++;
  connected = true;
  refresh?.();
}
reset();
window.payoutFixture = {
  reset,
  begin() {
    game.beginRoll(state, playerId);
    state.snapshotAt++;
    refresh();
  },
  finish(dice = [3, 4]) {
    game.finishRoll(state, dice);
    state.snapshotAt = Math.max(state.snapshotAt + 1, Date.now());
    refresh();
  },
  connection(value) {
    connected = value;
    refresh();
  },
  get state() {
    return structuredClone(state);
  },
};
function App() {
  const [, tick] = useState(0);
  refresh = () => tick((n) => n + 1);
  const view = structuredClone(state);
  return (
    <PhoneGame
      key={generation}
      state={view}
      player={view.players[0]}
      isAdmin
      send={() => {}}
      connected={connected}
      rollArea={<div data-dice-closeup>Shared dice closeup</div>}
    />
  );
}
createRoot(document.getElementById("root")).render(<App />);
