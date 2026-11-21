import { spawn } from "node:child_process";
import { once } from "node:events";
import {
  mkdir,
  mkdtemp,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout } from "node:timers/promises";

export async function startTestHost(network) {
  const files = await mkdtemp(path.join(tmpdir(), "crapstv-android-"));
  let root;
  let payloadVersion = 0;
  let child;
  let logs = "";
  async function updateNetwork(next) {
    const temporary = path.join(root, "network.json.tmp");
    await writeFile(temporary, JSON.stringify(next));
    await rename(temporary, path.join(root, "network.json"));
  }
  async function stopProcess() {
    if (child?.pid && child.exitCode === null && child.signalCode === null) {
      const exited = once(child, "exit");
      child.kill("SIGTERM");
      await exited;
    }
  }
  async function stop() {
    await stopProcess();
    await rm(files, { recursive: true, force: true });
  }
  async function installPayload() {
    root = path.join(files, `session-v${++payloadVersion}`);
    await mkdir(root);
    await symlink(
      path.resolve("android/host.html"),
      path.join(root, "host.html"),
    );
    await symlink(path.resolve("dist"), path.join(root, "dist"));
    await updateNetwork(network);
    child = spawn(process.execPath, ["android/host.cjs", root], {
      env: { ...process.env, PORT: "0", CRAPSTV_SAVE_PATH: "" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.on("data", (data) => (logs += data));
    child.stderr.on("data", (data) => (logs += data));
    child.on("error", (error) => (logs += error.message));
    for (let attempt = 0; attempt < 100; attempt++) {
      const port = /Android local room \w+, port (\d+)/.exec(logs)?.[1];
      if (port)
        return {
          url: `http://127.0.0.1:${port}`,
          port,
          updateNetwork,
          stop,
          replacePayload,
        };
      if (child.exitCode !== null) break;
      await setTimeout(50);
    }
    throw Error("The prepared Android host did not start.\n" + logs);
  }
  async function replacePayload() {
    await stopProcess();
    await rm(root, { recursive: true, force: true });
    logs = "";
    return installPayload();
  }
  try {
    return await installPayload();
  } catch (error) {
    await stop();
    throw error;
  }
}
