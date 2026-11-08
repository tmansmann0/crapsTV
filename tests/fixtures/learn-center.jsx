// Read-only browser harness; never connects to a room or sends game actions.
import React from "react";
import { createRoot } from "react-dom/client";
import LearnCenter from "../../src/LearnCenter.jsx";
import { createState, join } from "../../src/game.js";
import "../../src/phone-game.css";
import "../../node_modules/@fontsource/dm-sans/latin-500.css";
import "../../node_modules/@fontsource/dm-sans/latin-700.css";
import "../../node_modules/@fontsource/manrope/latin-800.css";
const state = createState("LEARNX");
const player = join(state, "Learn tester");
function freeze(value) {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
freeze(state);
window.learnFixture = { state, initial: JSON.stringify(state) };
createRoot(document.getElementById("root")).render(
  <div
    className="pg-shell"
    style={{ gridTemplateRows: "54px 50px minmax(0,1fr) 62px" }}
  >
    <header style={{ padding: "16px", borderBottom: "1px solid #ded3bf" }}>
      Learn · Read-only demo
    </header>
    <div
      style={{
        padding: "14px 16px",
        background: "#fffaf0",
        borderBottom: "1px solid #ded3bf",
        fontSize: 12,
      }}
    >
      Come-out · learning does not move chips
    </div>
    <main style={{ overflow: "auto", minHeight: 0, padding: "8px 10px" }}>
      <LearnCenter state={state} player={player} />
    </main>
    <nav
      style={{
        padding: "20px",
        textAlign: "center",
        borderTop: "1px solid #ded3bf",
      }}
    >
      Play　 Bets　 Roll　 <b>Learn</b>
    </nav>
  </div>,
);
