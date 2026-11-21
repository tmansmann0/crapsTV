import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout } from "node:timers/promises";

export async function startTestHost(network) {
  const root = await mkdtemp(path.join(tmpdir(), "crapstv-android-"));
  let child;
  let logs = "";
  async function updateNetwork(next) {
    const temporary = path.join(root, "network.json.tmp");
    await writeFile(temporary, JSON.stringify(next));
    await rename(temporary, path.join(root, "network.json"));
  }
  async function stop() {
    if (child?.pid && child.exitCode === null && child.signalCode === null) {
      const exited = once(child, "exit");
      child.kill("SIGTERM");
      await exited;
    }
    await rm(root, { recursive: true, force: true });
  }
  try {
    await symlink(
      path.resolve("android/host.html"),
      path.join(root, "host.html"),
    );
    await symlink(path.resolve("dist"), path.join(root, "dist"));
    await updateNetwork(network);
    child = spawn(process.execPath, ["android/host.cjs", root], {
      env: { ...process.env, PORT: "0" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.on("data", (data) => (logs += data));
    child.stderr.on("data", (data) => (logs += data));
    child.on("error", (error) => (logs += error.message));
    for (let attempt = 0; attempt < 100; attempt++) {
      const port = /Android local room \w+, port (\d+)/.exec(logs)?.[1];
      if (port)
        return { url: `http://127.0.0.1:${port}`, port, updateNetwork, stop };
      if (child.exitCode !== null) break;
      await setTimeout(50);
    }
    throw Error("The prepared Android host did not start.\n" + logs);
  } catch (error) {
    await stop();
    throw error;
  }
}
