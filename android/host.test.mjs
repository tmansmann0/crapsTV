import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { WebSocket } from "ws";

test("Android bundle serves offline assets, both QR steps and shared shooter authority", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "crapstv-android-"));
  for (const name of ["host.cjs", "host.html"])
    await symlink(path.resolve("android", name), path.join(root, name));
  await symlink(path.resolve("dist"), path.join(root, "dist"));
  await writeFile(
    path.join(root, "network.json"),
    JSON.stringify({
      ip: "127.0.0.1",
      ssid: "test;wifi",
      password: "test:password",
      mode: "local-only",
    }),
  );
  const child = spawn(process.execPath, ["android/host.cjs", root], {
    env: { ...process.env, PORT: "4376" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let logs = "";
  child.stdout.on("data", (d) => (logs += d));
  child.stderr.on("data", (d) => (logs += d));
  t.after(async () => {
    child.kill("SIGTERM");
    await rm(root, { recursive: true, force: true });
  });
  let cfg;
  for (let i = 0; i < 100; i++) {
    try {
      cfg = await (await fetch("http://127.0.0.1:4376/api/config")).json();
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 50));
    }
  }
  assert(cfg, logs);
  assert.equal(cfg.local, true);
  assert.equal(cfg.android, true);
  assert.match(cfg.code, /^[A-Z2-9]{6}$/);
  assert.equal(cfg.joinOrigin, "http://127.0.0.1:4376");
  for (const route of [
    "/",
    "/join?code=" + cfg.code,
    "/android-host",
    "/android-network",
    "/android-qr",
    "/android/qr.svg",
    "/android/qr.svg?kind=wifi",
  ]) {
    const r = await fetch("http://127.0.0.1:4376" + route);
    assert.equal(r.status, 200, route);
    if (route.includes(".svg")) assert.match(await r.text(), /<svg/);
  }
  function client() {
    const ws = new WebSocket("ws://127.0.0.1:4376/socket", {
        origin: "http://127.0.0.1:4376",
      }),
      messages = [];
    ws.on("message", (d) => messages.push(JSON.parse(d)));
    t.after(() => ws.terminate());
    return { ws, messages, send: (m) => ws.send(JSON.stringify(m)) };
  }
  async function until(predicate) {
    for (let i = 0; i < 600; i++) {
      const value = predicate();
      if (value) return value;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw Error("Timed out: " + logs);
  }
  const a = client(),
    b = client();
  await until(() => a.ws.readyState === 1 && b.ws.readyState === 1);
  a.send({ type: "join", code: cfg.code, name: "Android host" });
  const alice = await until(() => a.messages.find((m) => m.type === "welcome"));
  b.send({ type: "join", code: cfg.code, name: "Browser guest" });
  await until(() => b.messages.find((m) => m.type === "welcome"));
  a.send({ type: "start", config: { rollCooldownSeconds: 0 } });
  await until(() => b.messages.find((m) => m.state?.status === "playing"));
  b.send({ type: "roll", playerId: alice.playerId });
  await until(() =>
    b.messages.find(
      (m) => m.type === "error" && /current shooter/i.test(m.message),
    ),
  );
  a.send({ type: "roll" });
  await until(() => a.messages.find((m) => m.state?.rolling === true));
  await until(() => b.messages.find((m) => m.state?.lastRoll));
  const bad = new WebSocket("ws://127.0.0.1:4376/socket", {
    origin: "http://unrelated.example",
  });
  assert.equal(
    await new Promise((r) => bad.on("close", (code) => r(code))),
    1008,
  );
});
