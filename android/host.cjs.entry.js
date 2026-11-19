// Embedded authority: the same RoomHub as desktop and PR #4. No cloud services.
import express from "express";
import { createServer } from "node:http";
import { webcrypto, randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { WebSocketServer } from "ws";
import QRCode from "qrcode";
import { RoomHub } from "../src/hub.js";
globalThis.crypto ??= webcrypto;
const root = process.argv[2] || process.cwd();
const port = Number(process.env.PORT || 3000);
const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const code = Array.from(
  randomBytes(6),
  (b) => alphabet[b % alphabet.length],
).join("");
const hub = new RoomHub(code);
const app = express();
const server = createServer(app);
function status() {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, "network.json"), "utf8"));
  } catch {
    return {};
  }
}
const origin = () => {
  const ip = status().ip;
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(ip || "")
    ? `http://${ip}:${port}`
    : null;
};
app.get("/api/config", (_req, res) =>
  res.json({
    local: true,
    code,
    kiosk: false,
    joinOrigin: origin(),
    lanOrigin: origin(),
    android: true,
  }),
);
app.get("/android/status", (_req, res) =>
  res.json({
    ...status(),
    code,
    joinURL: origin() ? `${origin()}/join?code=${code}` : null,
  }),
);
app.get("/android/qr.svg", async (req, res) => {
  const s = status();
  const esc = (value) =>
    String(value || "").replace(/[\\;,:"\n\r]/g, (c) => `\\${c}`);
  const value =
    req.query.kind === "wifi"
      ? s.ssid && s.password
        ? `WIFI:T:WPA;S:${esc(s.ssid)};P:${esc(s.password)};;`
        : null
      : origin()
        ? `${origin()}/join?code=${code}`
        : null;
  if (!value) return res.status(503).send("Network not ready");
  res
    .type("svg")
    .set("Cache-Control", "no-store")
    .send(
      await QRCode.toString(value, {
        type: "svg",
        margin: 4,
        errorCorrectionLevel: "M",
        width: 1024,
      }),
    );
});
// Native WebView pages; guests use the normal /join application.
app.get(["/android-host", "/android-network", "/android-qr"], (_req, res) =>
  res.sendFile(path.join(root, "host.html")),
);
const wss = new WebSocketServer({ server, path: "/socket", maxPayload: 8192 });
wss.on("connection", (ws, req) => {
  if (req.headers.origin) {
    try {
      if (new URL(req.headers.origin).host !== req.headers.host) {
        ws.close(1008, "Origin not allowed");
        return;
      }
    } catch {
      ws.close(1008);
      return;
    }
  }
  const id = randomBytes(16).toString("hex");
  hub.connect(id, (m) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(m));
  });
  ws.on("message", (data) => {
    try {
      hub.receive(id, JSON.parse(data.toString()));
    } catch {
      ws.send(JSON.stringify({ type: "error", message: "Invalid message." }));
    }
  });
  ws.on("close", () => hub.disconnect(id));
  ws.on("error", () => ws.close());
  ws.isAlive = true;
  ws.on("pong", () => (ws.isAlive = true));
});
const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    ws.ping();
  }
}, 30000);
app.use(express.static(path.join(root, "dist")));
app.use((_req, res) => res.sendFile(path.join(root, "dist", "index.html")));
server.listen(port, "0.0.0.0", () =>
  console.log(`Android local room ${code}, port ${port}`),
);
process.on("SIGTERM", () => {
  clearInterval(heartbeat);
  hub.close();
  server.close();
  process.exit(0);
});
