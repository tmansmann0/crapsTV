import express from "express";
import { createServer } from "node:http";
import { networkInterfaces } from "node:os";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { WebSocketServer } from "ws";
import { RoomHub } from "../src/hub.js";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.PORT || 3000),
  app = express(),
  server = createServer(app);
const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const code = Array.from(
  randomBytes(6),
  (b) => alphabet[b % alphabet.length],
).join("");
const hub = new RoomHub(code);
app.get("/api/config", (_req, res) => res.json({ local: true, code }));
if (process.argv.includes("--dev")) {
  const { createServer } = await import("vite");
  const vite = await createServer({
    root,
    server: { middlewareMode: true },
    appType: "spa",
  });
  app.use(vite.middlewares);
} else {
  app.use(express.static(path.join(root, "dist")));
  app.use((_req, res) => res.sendFile(path.join(root, "dist", "index.html")));
}
const wss = new WebSocketServer({ server, path: "/socket", maxPayload: 8192 });
wss.on("connection", (ws, req) => {
  // Prevent third-party web pages from silently connecting to a LAN room.
  if (req.headers.origin) {
    try {
      const origin = new URL(req.headers.origin);
      if (origin.host !== req.headers.host) {
        ws.close(1008, "Origin not allowed");
        return;
      }
    } catch {
      ws.close(1008);
      return;
    }
  }
  const id = randomBytes(16).toString("hex");
  hub.connect(id, (message) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(message));
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
  ws.on("pong", () => {
    ws.isAlive = true;
  });
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
server.listen(port, "0.0.0.0", () => {
  console.log(`\n  crapsTV · room ${code}\n  TV: http://localhost:${port}\n`);
  for (const infos of Object.values(networkInterfaces()))
    for (const info of infos || [])
      if (info.family === "IPv4" && !info.internal)
        console.log(`  Phones: http://${info.address}:${port}/?join=${code}`);
  console.log(
    "\n  Keep this process running during your session. Ctrl+C to close.\n",
  );
});
function shutdown() {
  clearInterval(heartbeat);
  hub.close();
  for (const ws of wss.clients) ws.close();
  server.close(() => process.exit(0));
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
