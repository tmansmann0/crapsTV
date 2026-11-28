import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { createConnection } from "node:net";
import { setTimeout as wait } from "node:timers/promises";

function setPause(path, paused) {
  return new Promise((resolve, reject) => {
    const socket = createConnection(path);
    let buffer = "";
    const timer = setTimeout(() => finish(Error("mpv did not respond.")), 2000);
    function finish(error) {
      clearTimeout(timer);
      socket.destroy();
      if (error) reject(error);
      else resolve();
    }
    socket.setEncoding("utf8");
    socket.once("connect", () =>
      socket.write(
        JSON.stringify({
          command: ["set_property", "pause", paused],
          request_id: 1,
        }) + "\n",
      ),
    );
    socket.on("data", (chunk) => {
      buffer += chunk;
      const lines = buffer.split("\n");
      buffer = lines.pop();
      for (const line of lines) {
        let reply;
        try {
          reply = JSON.parse(line);
        } catch {
          continue;
        }
        if (reply?.request_id === 1) {
          finish(
            reply.error === "success"
              ? undefined
              : Error("mpv rejected the command."),
          );
          break;
        }
      }
    });
    socket.once("error", finish);
    socket.once("end", () => finish(Error("mpv closed the connection.")));
  });
}

export function createMpvPlaybackControl() {
  // Keep the Unix socket both private and short enough for macOS sockaddr_un.
  const dir =
    process.platform === "win32" ? null : mkdtempSync("/tmp/crapstv-mpv-");
  const path = dir
    ? `${dir}/player`
    : "\\\\.\\pipe\\crapstv-mpv-" + randomUUID();
  let closed = false;
  return {
    path,
    async setPaused(paused) {
      const deadline = Date.now() + 2000;
      while (!closed) {
        try {
          await setPause(path, paused);
          return;
        } catch (error) {
          // The first pause may arrive before mpv has opened its IPC endpoint.
          if (
            Date.now() >= deadline ||
            !["ENOENT", "ECONNREFUSED", "EBUSY"].includes(error.code)
          )
            throw error;
          await wait(50);
        }
      }
      throw Error("mpv has stopped.");
    },
    close() {
      closed = true;
      if (dir) rmSync(dir, { recursive: true, force: true });
    },
  };
}
