import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { WebSocket } from "ws";
import * as game from "../src/game.js";
import { RoomHub } from "../src/hub.js";
import { readRoomSave } from "../src/room-save.js";
import { fileRoomSave } from "../server/room-save-file.js";

const room = "SAVETB";
const timers = { setTimeout: () => null, clearTimeout: () => {} };

function join(hub, client, token, name = client) {
  const messages = [];
  hub.connect(client, (message) => messages.push(message));
  const send = (message) => hub.receive(client, message);
  send({ type: "join", code: room, name, token });
  return {
    messages,
    send,
    welcome: messages.find((m) => m.type === "welcome"),
  };
}

test("only the host can save or resume and a failed write leaves live play untouched", (t) => {
  let written;
  const hub = new RoomHub(room, {
    timers,
    saveStore: {
      write: (data) => {
        written = data;
      },
      remove: () => {
        written = null;
      },
    },
  });
  t.after(() => hub.close());
  const host = join(hub, "Host");
  const guest = join(hub, "Guest");
  host.send({ type: "start", config: { rollCooldownSeconds: 60 } });
  host.send({ type: "bet", betId: "pass", amount: 500 });
  guest.send({ type: "save-session" });
  assert.match(guest.messages.at(-1).message, /only the table host/i);
  assert.equal(written, undefined);
  const write = hub.saveStore.write;
  hub.saveStore.write = () => {
    throw Error("Disk full");
  };
  host.send({ type: "save-session" });
  assert.match(host.messages.at(-1).message, /could not be saved/i);
  assert.equal(hub.state.pausedAt, undefined);
  hub.saveStore.write = write;
  hub.state.rolling = true;
  host.send({ type: "save-session" });
  assert.match(host.messages.at(-1).message, /wait for the dice/i);
  hub.state.rolling = false;
  host.send({ type: "save-session" });
  assert(written.bettingRemainingMs > 0);
  assert.equal(hub.state.nextRollAt, null);
  assert(hub.state.pausedAt);
  assert.equal(hub.state.players[0].bets[0].amount, 500);
  const pausedSave = written;
  host.send({ type: "save-session" });
  assert.equal(written, pausedSave);
  guest.send({ type: "bet", betId: "field", amount: 500 });
  assert.match(guest.messages.at(-1).message, /table is saved/i);
  guest.send({ type: "resume-session" });
  assert.match(guest.messages.at(-1).message, /only the table host/i);
  assert.equal(join(hub, "New player").welcome, undefined);
  const stranger = join(hub, "Stranger");
  stranger.send({
    type: "join",
    code: room,
    token: "incorrect-token",
    reclaim: true,
    name: "Stranger",
  });
  assert.match(
    stranger.messages.at(-1).message,
    /reconnect code did not match/i,
  );
  assert.equal(hub.state.players.length, 2);
  const restoreWrite = hub.saveStore.remove;
  hub.saveStore.remove = () => {
    throw Error("Read-only disk");
  };
  host.send({ type: "resume-session" });
  assert.match(host.messages.at(-1).message, /could not be resumed/i);
  assert.equal(written, pausedSave);
  hub.saveStore.remove = restoreWrite;
  host.send({ type: "resume-session" });
  assert.equal(hub.state.pausedAt, undefined);
  assert.equal(written, null);
  assert(
    hub.state.nextRollAt >= Date.now() + pausedSave.bettingRemainingMs - 100,
  );
  stranger.send({
    type: "join",
    code: room,
    token: "incorrect-token",
    reclaim: true,
    name: "Stranger",
  });
  assert.match(
    stranger.messages.at(-1).message,
    /reconnect code did not match/i,
  );
  assert.equal(hub.state.players.length, 2);
});

test("older saves keep the ledger and gains defaults without restoring motion or connection state", (t) => {
  const state = game.createState(room);
  const host = game.join(state, "Host"),
    guest = game.join(state, "Guest");
  game.configure(state, host.id, { drinkingMode: true });
  game.start(state, host.id);
  game.requestDrink(state, host.id, {
    kind: "credit",
    unit: "sip",
    quantity: 2,
  });
  host.bankrollAdjustments = { added: 500, removed: 200 };
  delete state.config.drinkingRules;
  delete state.display.graphics;
  state.physicsVersion = 1;
  state.aim = { active: true, playerId: host.id };
  state.throw = { id: "expired-flight" };
  const before = {
    state,
    tokens: [
      ["original-host", host.id],
      ["original-guest", guest.id],
    ],
  };
  const migrated = readRoomSave(JSON.stringify(before));
  assert.deepEqual(migrated.state.drinkRequests, state.drinkRequests);
  assert.deepEqual(
    migrated.state.players[0].bankrollAdjustments,
    host.bankrollAdjustments,
  );
  assert(migrated.state.config.drinkingRules.sipValue > 0);
  assert(migrated.state.display.graphics);
  assert(migrated.state.physicsVersion > 1);
  assert.equal(migrated.state.aim, null);
  assert.equal(migrated.state.throw, null);
  assert.equal(migrated.state.players[0].connected, false);
  const hub = new RoomHub(room, {
    restored: migrated,
    saveStore: { remove() {} },
  });
  t.after(() => hub.close());
  const rejoined = join(hub, "Rejoined phone", "original-host");
  assert.equal(rejoined.welcome.playerId, host.id);
  assert.equal(rejoined.welcome.token, "original-host");
  assert.equal(hub.state.adminId, host.id);
  assert.equal(hub.state.shooterId, host.id);
  assert.equal(hub.state.players.length, 2);
  assert.throws(
    () => readRoomSave(JSON.stringify({ ...before, version: 99 })),
    /newer version/,
  );
});

async function waitFor(read) {
  for (let i = 0; i < 500; i++) {
    const value = await read();
    if (value) return value;
    await delay(20);
  }
  throw Error("Timed out waiting for the local room.");
}

test("a real server restart restores its room code, host token, point, bets and ledger", async (t) => {
  const temp = await mkdtemp(path.join(tmpdir(), "crapstv-restart-"));
  const file = path.join(temp, "table.json");
  const probe = createServer();
  probe.listen(0, "127.0.0.1");
  await once(probe, "listening");
  const { port } = probe.address();
  await new Promise((resolve) => probe.close(resolve));
  const url = `http://127.0.0.1:${port}`;
  let child;
  const sockets = new Set();
  async function stop() {
    for (const socket of sockets) socket.terminate();
    sockets.clear();
    if (!child?.pid || child.exitCode !== null || child.signalCode !== null)
      return;
    const exited = once(child, "exit");
    child.kill("SIGTERM");
    await exited;
  }
  t.after(async () => {
    await stop();
    await rm(temp, { recursive: true, force: true });
  });

  async function start() {
    child = spawn(process.execPath, ["server/index.js"], {
      env: {
        ...process.env,
        PORT: String(port),
        CRAPSTV_MDNS: "0",
        CRAPSTV_SAVE_PATH: file,
      },
      stdio: "ignore",
    });
    return waitFor(async () => {
      try {
        return await (await fetch(url + "/api/config")).json();
      } catch {
        return null;
      }
    });
  }
  async function phone() {
    const socket = new WebSocket(url.replace(/^http/, "ws") + "/socket");
    sockets.add(socket);
    const messages = [];
    socket.on("message", (data) => messages.push(JSON.parse(data)));
    await once(socket, "open");
    return {
      send: (data) => socket.send(JSON.stringify(data)),
      receive: (predicate) => waitFor(() => messages.findLast(predicate)),
    };
  }

  const config = await start();
  const host = await phone();
  host.send({ type: "join", code: config.code, name: "Tablet host" });
  const original = await host.receive((m) => m.type === "welcome");
  host.send({ type: "start", config: { rollCooldownSeconds: 0 } });
  await host.receive((m) => m.state?.status === "playing");
  host.send({ type: "bet", betId: "place-6", amount: 600 });
  await host.receive((m) => m.state?.players[0]?.bets.length);
  host.send({ type: "roll" });
  const rolled = (
    await host.receive((m) => m.state?.lastRoll && !m.state.rolling)
  ).state;
  host.send({ type: "save-session" });
  await host.receive((m) => m.state?.pausedAt);
  await stop();

  assert.equal((await start()).code, config.code);
  const returned = await phone();
  const paused = (await returned.receive((m) => m.state?.pausedAt)).state;
  assert.equal(paused.point, rolled.point);
  assert.deepEqual(paused.rolls, rolled.rolls);
  assert.deepEqual(paused.players[0].bets, rolled.players[0].bets);
  assert.equal(paused.players[0].bank, rolled.players[0].bank);
  assert(!JSON.stringify(paused).includes(original.token));
  returned.send({
    type: "join",
    code: config.code,
    token: "wrong-code",
    reclaim: true,
  });
  await returned.receive(
    (m) => m.type === "error" && /did not match/i.test(m.message),
  );
  returned.send({
    type: "join",
    code: config.code,
    token: original.token,
    reclaim: true,
  });
  assert.equal(
    (await returned.receive((m) => m.type === "welcome")).playerId,
    original.playerId,
  );
  returned.send({ type: "resume-session" });
  const resumed = (
    await returned.receive((m) => m.state?.nextRollAt && !m.state.pausedAt)
  ).state;
  assert.equal(resumed.adminId, original.playerId);
  assert.equal(resumed.players.length, 1);
  assert.equal(fileRoomSave(file).load(), null);
});
