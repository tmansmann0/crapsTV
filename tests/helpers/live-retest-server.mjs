// Test-only real authority. A longer recorded throw lets slow software GPUs
// present multiple physical poses; production server timing remains2500ms.
import express from "express";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import { RoomHub } from "../../src/hub.js";

const port = Number(process.env.PORT),
  code = "RETEST",
  throwDurationMs = 8000;
const hub = new RoomHub(code, { rollDelay: throwDurationMs });
let observedRolling = false;
const app = express(),
  server = createServer(app);
app.get("/api/config", (_req, res) =>
  res.json({
    local: true,
    code,
    joinBaseURL: `http://127.0.0.1:${port}`,
    testAuthority: { implementation: "RoomHub", throwDurationMs },
  }),
);
app.use(express.static(fileURLToPath(new URL("../../dist/", import.meta.url))));
app.use((_req, res) =>
  res.sendFile(
    fileURLToPath(new URL("../../dist/index.html", import.meta.url)),
  ),
);
const sockets = new WebSocketServer({ server, path: "/socket" });
sockets.on("connection", (ws) => {
  const id = randomUUID();
  hub.connect(id, (message) => {
    if (message.type === "state" && message.state.rolling !== observedRolling) {
      observedRolling = message.state.rolling;
      console.log(
        JSON.stringify({
          at: performance.now(),
          rolling: observedRolling,
          throwId: message.state.throw?.id,
        }),
      );
    }
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(message));
  });
  ws.on("message", (raw) => {
    try {
      hub.receive(id, JSON.parse(raw));
    } catch {
      ws.send(
        JSON.stringify({
          type: "error",
          message: "Invalid test socket message",
        }),
      );
    }
  });
  ws.on("close", () => hub.disconnect(id));
  ws.on("error", () => ws.close());
});
server.listen(port, "127.0.0.1");
process.on("SIGTERM", () => {
  hub.close();
  for (const socket of sockets.clients) socket.terminate();
  sockets.close();
  server.close(() => process.exit(0));
});
