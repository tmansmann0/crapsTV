import express from "express";
import { createServer } from "node:http";
import { networkInterfaces } from "node:os";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { WebSocketServer } from "ws";
import { RoomHub } from "../src/hub.js";
import { createLocalDiscovery } from "./local-discovery.js";
import { runtimeOptions } from "./runtime-options.js";
const { kiosk } = runtimeOptions();
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
let devServer;
const devAllowedHosts = [];
let resolveAppReady;
const appReady = new Promise((resolve) => {
  resolveAppReady = resolve;
});
const discovery = createLocalDiscovery({
  port,
  code,
  log: (message) => console.log(`  ${message}`),
  onChange: ({ localHostname }) => {
    if (localHostname && !devAllowedHosts.includes(localHostname)) {
      devAllowedHosts.push(localHostname);
      // Vite freezes the host list inside its middleware. A conflict after
      // startup requires rebuilding that middleware from our updated list.
      if (devServer) devServer.restart().catch((error) => console.error(error));
    }
  },
});
app.get("/api/config", async (_req, res) => {
  await appReady;
  res.json({ local: true, code, kiosk, ...discovery.config() });
});
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
let shuttingDown = false;
async function shutdown(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  clearInterval(heartbeat);
  hub.close();
  for (const ws of wss.clients) ws.close();
  const closingServer = new Promise((resolve) => server.close(resolve));
  const forceClose = setTimeout(() => {
    for (const ws of wss.clients) ws.terminate();
    server.closeAllConnections();
  }, 1500);
  forceClose.unref();
  await Promise.all([discovery.stop(), closingServer, devServer?.close()]);
  clearTimeout(forceClose);
  process.exit(exitCode);
}
process.on("SIGINT", () => shutdown());
process.on("SIGTERM", () => shutdown());

try {
  // Bind first: a failed/occupied HTTP port must never claim a local hostname.
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "0.0.0.0", resolve);
  });
  const local = await discovery.start();
  if (process.argv.includes("--dev")) {
    const { createServer } = await import("vite");
    const vite = await createServer({
      root,
      // Isolated visual tests use Vite too. Never let their dependency optimizer
      // replace the live preview's cached bundles while a browser is using them.
      cacheDir: path.join(root, "node_modules", ".vite-crapstv", String(port)),
      server: {
        middlewareMode: true,
        allowedHosts: devAllowedHosts,
        hmr: { port: 20000 + (port % 30000) },
      },
      appType: "spa",
    });
    devServer = vite;
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(root, "dist")));
    app.use((_req, res) => res.sendFile(path.join(root, "dist", "index.html")));
  }
  resolveAppReady();
  if (!shuttingDown) {
    console.log(`\n  crapsTV · room ${code}\n  TV: http://localhost:${port}\n`);
    if (kiosk) console.log("  TV kiosk mode: on-screen settings are hidden.");
    if (local.localOrigin) console.log(`  Local: ${local.localOrigin}`);
    if (local.joinOrigin)
      console.log(`  Join: ${local.joinOrigin}/join?code=${code}`);
    for (const infos of Object.values(networkInterfaces()))
      for (const info of infos || [])
        if (info.family === "IPv4" && !info.internal)
          console.log(
            `  Phones: http://${info.address}:${port}/join?code=${code}`,
          );
    console.log(
      "\n  Keep this process running during your session. Ctrl+C to close.\n",
    );
  }
} catch (error) {
  console.error(`crapsTV could not start: ${error.message}`);
  await shutdown(1);
}
