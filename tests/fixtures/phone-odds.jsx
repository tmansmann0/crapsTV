// Browser-only fixture: real rules and component, isolated from live room servers.
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import PhoneGame from "../../src/PhoneGame.jsx";
import * as game from "../../src/game.js";
import "../../node_modules/@fontsource/dm-sans/latin-500.css";
import "../../node_modules/@fontsource/dm-sans/latin-700.css";
import "../../node_modules/@fontsource/manrope/latin-800.css";

let state,
  playerId,
  generation = 0,
  refresh,
  setFixtureError;
const messages = [];
function reset({
  point = null,
  line = "pass",
  hasLine = false,
  bank,
  mode = "craps",
} = {}) {
  state = game.createState("ODDSQA");
  state.config.mode = mode;
  const player = game.join(state, "Odds Tester");
  playerId = player.id;
  game.configure(state, playerId, { rollCooldownSeconds: 0 }); // Immediate rolls for this isolated fixture.
  game.start(state, playerId);
  if (hasLine) game.place(state, playerId, line, 500);
  if (point) {
    game.beginRoll(state, playerId);
    game.finishRoll(state, [2, 2]); // Four is an actual point-setting roll.
  }
  if (bank !== undefined) player.bank = bank;
  generation++;
  messages.length = 0;
  refresh?.();
}
reset();
window.oddsFixture = {
  reset,
  get state() {
    return structuredClone(state);
  },
  get playerId() {
    return playerId;
  },
  get messages() {
    return [...messages];
  },
  teach(value) {
    state.config.teach = value;
    refresh();
  },
  error(text) {
    setFixtureError(text);
  },
  placeOdds(amount) {
    const row = game.catalogue(state, state.players[0]).find((r) => r.parent);
    game.place(state, playerId, row.id, amount);
    refresh();
  },
  finishPoint() {
    game.beginRoll(state, playerId);
    game.finishRoll(state, [2, 2]);
    refresh();
  },
};
function App() {
  const [, tick] = useState(0);
  const [error, setError] = useState("");
  setFixtureError = setError;
  refresh = () => tick((v) => v + 1);
  const send = (message) => {
    messages.push(message);
    try {
      if (message.type === "bet-preview")
        game.previewBet(state, playerId, message.amount, message.betId ?? null);
      if (message.type === "bet")
        game.place(state, playerId, message.betId, message.amount);
      if (message.type === "remove")
        game.remove(state, playerId, message.betId);
      setError("");
    } catch (e) {
      setError(e.message);
    }
    refresh();
  };
  const view = structuredClone(state);
  return (
    <PhoneGame
      key={generation}
      state={view}
      player={view.players[0]}
      isAdmin
      send={send}
      connected
      serverError={error}
    />
  );
}
createRoot(document.getElementById("root")).render(<App />);
