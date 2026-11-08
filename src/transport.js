import { Peer } from "peerjs";
import { RoomHub } from "./hub.js";
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const newCode = () =>
  Array.from(
    crypto.getRandomValues(new Uint8Array(6)),
    (x) => ALPHABET[x % ALPHABET.length],
  ).join("");
export async function detectLocal() {
  try {
    const r = await fetch(new URL("api/config", document.baseURI), {
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return null;
    const json = await r.json();
    return json.local ? json : null;
  } catch {
    return null;
  }
}
export function localTransport(onMessage, onStatus) {
  let socket,
    closed = false,
    retry;
  const queue = [];
  function open() {
    onStatus("connecting");
    socket = new WebSocket(
      `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/socket`,
    );
    socket.onopen = () => {
      onStatus("connected");
      while (queue.length) socket.send(JSON.stringify(queue.shift()));
    };
    socket.onmessage = (e) => onMessage(JSON.parse(e.data));
    socket.onclose = () => {
      if (!closed) {
        onStatus("reconnecting");
        retry = setTimeout(open, 1500);
      }
    };
    socket.onerror = () => socket.close();
  }
  open();
  return {
    send(m) {
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(m));
      else if (m.type === "join" || m.type === "watch") queue.push(m);
      else
        onMessage({
          type: "error",
          message: "Reconnecting. Try that action again when connected.",
        });
    },
    close() {
      closed = true;
      clearTimeout(retry);
      socket.close();
    },
  };
}
export function onlineTransport(code, hosting, onMessage, onStatus) {
  const peer = new Peer(hosting ? `crapstv-v1-${code}` : undefined, {
    debug: 0,
  });
  let hub,
    conn,
    closed = false,
    ready = false,
    timer;
  const queue = [];
  const flush = () => {
    ready = true;
    onStatus("connected");
    while (queue.length) send(queue.shift());
  };
  function send(m) {
    if (!ready) {
      if (["join", "watch"].includes(m.type)) queue.push(m);
      else
        onMessage({
          type: "error",
          message: "The table is connecting. Try again shortly.",
        });
      return;
    }
    if (hosting) hub.receive("display", m);
    else if (conn?.open) conn.send(m);
  }
  onStatus("connecting");
  peer.on("open", () => {
    if (hosting) {
      hub = new RoomHub(code);
      hub.connect("display", onMessage);
      peer.on("connection", (c) => {
        c.on("open", () => {
          hub.connect(c.connectionId, (m) => c.send(m));
          c.on("data", (m) => hub.receive(c.connectionId, m));
          c.on("close", () => hub.disconnect(c.connectionId));
          c.on("error", () => hub.disconnect(c.connectionId));
        });
      });
      flush();
    } else {
      conn = peer.connect(`crapstv-v1-${code}`, { reliable: true });
      conn.on("open", flush);
      conn.on("data", onMessage);
      conn.on("close", () => {
        ready = false;
        onStatus("disconnected");
        onMessage({
          type: "error",
          message:
            "The TV host disconnected. Keep this page for your last recap, or reconnect from the lobby.",
        });
      });
      conn.on("error", () => onStatus("disconnected"));
      timer = setTimeout(() => {
        if (!ready)
          onMessage({
            type: "error",
            message:
              "Could not reach that TV. Check the code and keep the host tab open. A restrictive network may block WebRTC.",
          });
      }, 14000);
    }
  });
  peer.on("error", (err) => {
    onStatus("disconnected");
    onMessage({
      type: "error",
      message:
        err.type === "unavailable-id"
          ? "That room code is in use. Open a new online table."
          : `Online connection: ${err.message}`,
    });
  });
  return {
    send,
    close() {
      closed = true;
      clearTimeout(timer);
      hub?.close();
      conn?.close();
      peer.destroy();
    },
    get closed() {
      return closed;
    },
  };
}
