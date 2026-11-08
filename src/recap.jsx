import { useState } from "react";
import { Download, ArrowUpRight, ArrowDownRight } from "lucide-react";
import { recap, money } from "./game.js";
function graph(history, w = 800, h = 200) {
  const vals = history.map((p) => p.net),
    min = Math.min(0, ...vals),
    max = Math.max(1, ...vals),
    range = max - min;
  return {
    points: vals
      .map(
        (v, i) =>
          `${(i / (vals.length - 1 || 1)) * w},${h - ((v - min) / range) * h}`,
      )
      .join(" "),
    zero: h - ((0 - min) / range) * h,
    min,
    max,
  };
}
const escape = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&apos;",
      })[c],
  );
export async function downloadCard(player, state, format = "png") {
  const r = recap(player),
    g = graph(player.history, 880, 240);
  const text = (x, y, size, value, extra = "") =>
    `<text x="${x}" y="${y}" font-size="${size}" ${extra}>${escape(value)}</text>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1440" viewBox="0 0 1080 1440"><rect width="1080" height="1440" fill="#efe9de"/><circle cx="960" cy="40" r="400" fill="#e6dac6"/><g fill="#4a1d21" font-family="Arial, sans-serif">${text(100, 130, 35, "crapsTV  /  YOUR NIGHT, RECAPPED")}${text(100, 300, 28, "A LITTLE VEGAS. A LOT OF " + player.name.toUpperCase() + ".")}${text(100, 420, 80, r.title, 'font-family="Georgia,serif"')}${text(100, 520, 36, player.name + "’s night at the table")}${text(100, 710, 136, (r.net >= 0 ? "+" : "−") + money(Math.abs(r.net)), 'font-weight="bold"')}${text(100, 770, 26, "NET RESULT · RE-UPS INCLUDED IN YOUR BUY-IN")}<g transform="translate(100 850)"><path d="M0 ${g.zero}H880" stroke="#af9985" stroke-dasharray="8 8" fill="none"/><polyline points="${g.points}" fill="none" stroke="#275b49" stroke-width="8" stroke-linejoin="round"/></g>${text(100, 1160, 25, "ROLLS SEEN")}${text(100, 1220, 50, player.stats.rolls)}${text(380, 1160, 25, "BIGGEST WIN")}${text(380, 1220, 50, money(player.stats.biggestWin))}${text(740, 1160, 25, "RE-UPS")}${text(740, 1220, 50, player.stats.reups)}${text(100, 1340, 22, `${state.config.mode === "crapless" ? "CRAPLESS CRAPS" : "CLASSIC CRAPS"} · ROOM ${state.code} · PLAY CHIPS ONLY`)}</g></svg>`;
  const svgBlob = new Blob([svg], { type: "image/svg+xml" });
  let blob = svgBlob;
  if (format === "png") {
    const imageUrl = URL.createObjectURL(svgBlob);
    try {
      const image = new Image();
      image.src = imageUrl;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = 1080;
      canvas.height = 1440;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("PNG export unavailable; use the SVG option.");
      ctx.drawImage(image, 0, 0);
      blob = await new Promise((resolve, reject) =>
        canvas.toBlob(
          (result) =>
            result
              ? resolve(result)
              : reject(new Error("PNG export unavailable; use SVG.")),
          "image/png",
        ),
      );
    } finally {
      URL.revokeObjectURL(imageUrl);
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `crapsTV-${player.name.replace(/[^a-z0-9]/gi, "-")}-recap.${format}`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
export default function Recap({ player, state, compact = false }) {
  const [exportError, setExportError] = useState("");
  const r = recap(player),
    g = graph(player.history, 800, 180);
  return (
    <article
      className={`recap ${compact ? "compact" : ""}`}
      style={{ "--player": player.color }}
    >
      <div className="eyebrow">
        YOUR NIGHT, RECAPPED <span>✦</span>
      </div>
      <p className="recap-name">{player.name}, you’re</p>
      <h2>{r.title}.</h2>
      <div className={`net ${r.net < 0 ? "negative" : ""}`}>
        {r.net >= 0 ? <ArrowUpRight /> : <ArrowDownRight />}
        {r.net >= 0 ? "+" : "−"}
        {money(Math.abs(r.net))}
      </div>
      <p className="muted">
        Net result after {money(player.buyIn)} in total buy-ins.
      </p>
      <div className="recap-chart">
        <svg viewBox="0 0 800 200" aria-label="Net winnings across the session">
          <line
            x1="0"
            x2="800"
            y1={g.zero + 10}
            y2={g.zero + 10}
            stroke="currentColor"
            opacity=".2"
            strokeDasharray="6 6"
          />
          <polyline
            points={g.points}
            transform="translate(0 10)"
            fill="none"
            stroke="currentColor"
            strokeWidth="5"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        </svg>
        <span>FIRST CHIPS</span>
        <span>LAST CALL</span>
      </div>
      <div className="recap-stats">
        <div>
          <b>{player.stats.rolls}</b>
          <span>Rolls seen</span>
        </div>
        <div>
          <b>{money(player.stats.biggestWin)}</b>
          <span>Biggest bet win</span>
        </div>
        <div>
          <b>{player.stats.reups}</b>
          <span>Comebacks</span>
        </div>
      </div>
      <button
        className="button dark"
        onClick={() =>
          downloadCard(player, state).catch((e) => setExportError(e.message))
        }
      >
        <Download size={17} /> Save your recap card
      </button>
      <button
        className="text-button svg-export"
        onClick={() => downloadCard(player, state, "svg")}
      >
        Or save an editable SVG
      </button>
      {exportError && <p role="alert">{exportError}</p>}
      <small>1080 × 1440 PNG · play chips, real memories.</small>
    </article>
  );
}
