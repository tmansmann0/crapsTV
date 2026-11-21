// Embedded authority using the same RoomHub as the desktop server.
import { createServer } from "node:http";
import { webcrypto, randomBytes } from "node:crypto";
import { isIPv4 } from "node:net";
import fs from "node:fs";
import path from "node:path";
import { WebSocketServer } from "ws";
import QRCode from "qrcode";
import serveStatic from "serve-static";
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
// The Android Node build has no ICU. Using the static-file middleware
// directly keeps Express's Unicode-dependent router out of this bundle.
const gameFiles = serveStatic(path.join(root, "dist"), { redirect: false });
const pairingPage = fs.readFileSync(path.join(root, "host.html"));
const hostPaths = new Set(["/android-host", "/android-network", "/android-qr"]);

function status() {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, "network.json"), "utf8"));
  } catch {
    return {};
  }
}
const origin = (network) =>
  isIPv4(network.ip) ? `http://${network.ip}:${server.address().port}` : null;
const invite = (network) => {
  const address = origin(network);
  return address ? `${address}/join?code=${code}` : null;
};

function send(res, statusCode, contentType, body) {
  res.writeHead(statusCode, { "Content-Type": contentType });
  res.end(body);
}
const json = (res, body) =>
  send(res, 200, "application/json", JSON.stringify(body));

function isHost(req) {
  // Credentials belong to the host's loopback view. Validate both the actual
  // connection and the requested host, independently of any forwarded headers.
  return (
    req.socket.remoteAddress === "127.0.0.1" &&
    /^(?:127\.0\.0\.1|localhost)(?::\d+)?$/i.test(req.headers.host || "") &&
    req.headers["sec-fetch-site"] !== "cross-site"
  );
}

async function pair(req, res, url) {
  if (!isHost(req)) return send(res, 404, "text/plain", "Not found");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Frame-Options", "DENY");
  if (hostPaths.has(url.pathname))
    return send(res, 200, "text/html; charset=utf-8", pairingPage);

  const network = status();
  if (url.pathname === "/android/status")
    return json(res, {
      ...network,
      code,
      joinURL: invite(network),
      controllerURL: `/join?code=${code}`,
    });

  const esc = (value) =>
    String(value || "").replace(/[\\;,:"\n\r]/g, (c) => `\\${c}`);
  const wifi = url.searchParams.get("kind") === "wifi";
  const value = wifi
    ? network.mode === "local-only" && network.ssid
      ? `WIFI:T:${network.password ? "WPA" : "nopass"};S:${esc(network.ssid)};P:${esc(network.password)};;`
      : null
    : invite(network);
  if (!value) return send(res, 503, "text/plain", "Network not ready");
  const svg = await QRCode.toString(value, {
    type: "svg",
    margin: 4,
    errorCorrectionLevel: "M",
    width: 1024,
  });
  send(res, 200, "image/svg+xml", svg);
}

const server = createServer((req, res) => {
  if (req.method !== "GET" && req.method !== "HEAD")
    return send(res, 405, "text/plain", "Method not allowed");
  let url;
  try {
    url = new URL(req.url, "http://127.0.0.1");
  } catch {
    return send(res, 400, "text/plain", "Invalid request");
  }
  if (url.pathname === "/api/config") {
    const address = origin(status());
    res.setHeader("Cache-Control", "no-store");
    return json(res, {
      local: true,
      code,
      kiosk: false,
      joinOrigin: address,
      lanOrigin: address,
      android: true,
    });
  }
  if (
    hostPaths.has(url.pathname) ||
    url.pathname === "/android/status" ||
    url.pathname === "/android/qr.svg"
  )
    return pair(req, res, url).catch(() =>
      send(res, 500, "text/plain", "The pairing QR could not be generated."),
    );
  if (url.pathname === "/join" || url.pathname === "/join/")
    req.url = "/index.html";
  gameFiles(req, res, (error) => {
    if (res.headersSent) res.destroy();
    else
      send(
        res,
        error?.statusCode || 404,
        "text/plain",
        "Game file unavailable",
      );
  });
});

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
server.listen(port, "0.0.0.0", () =>
  console.log(`Android local room ${code}, port ${server.address().port}`),
);
process.on("SIGTERM", () => {
  clearInterval(heartbeat);
  hub.close();
  server.close();
  process.exit(0);
});
