import { test } from "node:test";
import assert from "node:assert/strict";
import { networkInterfaces } from "node:os";
import { WebSocket } from "ws";
import { startTestHost } from "./test-host.mjs";

test("Android bundle serves offline assets, both QR steps and shared shooter authority", async (t) => {
  const host = await startTestHost({
    ip: "127.0.0.1",
    ssid: "test;wifi",
    password: "test:password",
    mode: "local-only",
  });
  t.after(host.stop);
  const cfg = await (await fetch(host.url + "/api/config")).json();
  assert.equal(cfg.local, true);
  assert.equal(cfg.android, true);
  assert.match(cfg.code, /^[A-Z2-9]{6}$/);
  assert.equal(cfg.joinOrigin, host.url);
  assert.equal(Object.hasOwn(cfg, "password"), false);
  const audio = await fetch(host.url + "/audio/table/room.mp3", {
    headers: { Range: "bytes=0-63" },
  });
  assert.equal(audio.status, 206);
  assert.equal((await audio.arrayBuffer()).byteLength, 64);
  for (const route of [
    "/",
    "/join?code=" + cfg.code,
    "/android-host",
    "/android-network",
    "/android-qr",
    "/android/qr.svg",
    "/android/qr.svg?kind=wifi",
  ]) {
    const r = await fetch(host.url + route);
    assert.equal(r.status, 200, route);
    if (route.includes(".svg")) assert.match(await r.text(), /<svg/);
  }
  const status = await fetch(host.url + "/android/status");
  assert.match(status.headers.get("cache-control"), /no-store/);
  assert.equal((await status.json()).password, "test:password");
  const untrusted = await fetch(host.url + "/android/status", {
    headers: { "Sec-Fetch-Site": "cross-site" },
  });
  assert.equal(untrusted.status, 404);
  const lan = Object.values(networkInterfaces())
    .flat()
    .find((entry) => !entry.internal && entry.family === "IPv4");
  if (lan) {
    const guest = `http://${lan.address}:${host.port}`;
    for (const route of [
      "/android-host",
      "/android-network",
      "/android-qr",
      "/android/status",
      "/android/qr.svg?kind=wifi",
    ]) {
      assert.equal((await fetch(guest + route)).status, 404, route);
    }
    assert.equal((await fetch(guest + "/join?code=" + cfg.code)).status, 200);
    assert.equal(
      (await (await fetch(guest + "/api/config")).json()).code,
      cfg.code,
    );
  }
  function client() {
    const ws = new WebSocket(`ws://127.0.0.1:${host.port}/socket`, {
        origin: host.url,
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
    throw Error("Timed out waiting for the game state");
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
  const bad = new WebSocket(`ws://127.0.0.1:${host.port}/socket`, {
    origin: "http://unrelated.example",
  });
  assert.equal(
    await new Promise((r) => bad.on("close", (code) => r(code))),
    1008,
  );
});
