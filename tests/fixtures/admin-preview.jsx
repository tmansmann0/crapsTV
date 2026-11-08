import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import AdminPanel from "../../src/AdminPanel.jsx";
import * as game from "../../src/game.js";
import "@fontsource/dm-sans/latin-400.css";
import "@fontsource/dm-sans/latin-600.css";
import "@fontsource/manrope/latin-700.css";
import "@fontsource/manrope/latin-800.css";
import "../../src/style.css";
const initial = game.createState("HOSTQA");
const host = game.join(initial, "Alex");
game.join(initial, "Blair");
const bot = game.join(initial, "Ruby");
bot.bot = { strategy: "six-eight", difficulty: "regular" };
const actions = [];
let setCurrent;
window.adminQA = {
  actions,
  playing() {
    initial.status = "playing";
    setCurrent(structuredClone(initial));
  },
  full() {
    while (initial.players.filter((p) => !p.left).length < 12) {
      const next = game.join(initial, `Bot ${initial.players.length}`);
      next.bot = { strategy: "line", difficulty: "casual" };
    }
    setCurrent(structuredClone(initial));
  },
};
function App() {
  const [state, setState] = useState(structuredClone(initial));
  setCurrent = setState;
  const send = (message) => {
    actions.push(message);
    if (message.type === "add-bot") {
      const next = game.join(initial, message.name);
      next.bot = { strategy: message.strategy, difficulty: message.difficulty };
    }
    if (message.type === "remove-bot")
      initial.players.find((p) => p.id === message.playerId).left = true;
    if (message.type === "cooldown")
      initial.config.rollCooldownSeconds = message.seconds;
    if (message.type === "bot-delay")
      initial.config.botRollDelaySeconds = message.seconds;
    if (message.type === "display")
      initial.display = {
        ...initial.display,
        ...message.settings,
        graphics: { ...initial.display.graphics, ...message.settings.graphics },
      };
    if (message.type === "teach") initial.config.teach = message.value;
    setState(structuredClone(initial));
  };
  return (
    <main
      style={{
        maxWidth: 420,
        margin: "0 auto",
        padding: "18px 17px",
        minHeight: "100dvh",
        background: "#f3efe6",
      }}
    >
      <AdminPanel
        state={state}
        player={host}
        send={send}
        connected={true}
        confirm={(type) => actions.push({ confirm: type })}
        onDisplayAction={(type) => actions.push({ display: type })}
        fallbackJoinURL="http://127.0.0.1/join"
      />
    </main>
  );
}
createRoot(document.getElementById("root")).render(<App />);
