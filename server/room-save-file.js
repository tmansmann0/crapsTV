import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { readRoomSave } from "../src/room-save.js";

export function desktopSavePath(port, env = process.env) {
  if (env.CRAPSTV_SAVE_PATH) return path.resolve(env.CRAPSTV_SAVE_PATH);
  const home = os.homedir();
  const stateDir =
    process.platform === "win32"
      ? env.LOCALAPPDATA || path.join(home, "AppData", "Local")
      : env.XDG_STATE_HOME || path.join(home, ".local", "state");
  return path.join(stateDir, "crapstv", `room-${port}.json`);
}

export function fileRoomSave(file) {
  return {
    load() {
      try {
        return readRoomSave(fs.readFileSync(file, "utf8"));
      } catch (error) {
        if (error.code === "ENOENT") return null;
        throw error;
      }
    },
    write(save) {
      if (fs.existsSync(file))
        throw Error("This host already has a saved table.");
      fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
      const temporary = `${file}.${randomUUID()}.tmp`;
      try {
        const descriptor = fs.openSync(temporary, "wx", 0o600);
        try {
          fs.writeFileSync(descriptor, JSON.stringify(save));
          fs.fsyncSync(descriptor);
        } finally {
          fs.closeSync(descriptor);
        }
        // Link the completed file atomically. A second host sharing this path
        // cannot replace an existing paused table with a different checkpoint.
        fs.linkSync(temporary, file);
      } finally {
        fs.rmSync(temporary, { force: true });
      }
    },
    remove() {
      fs.unlinkSync(file);
    },
  };
}
