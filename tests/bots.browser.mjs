// Real Node authority and phone controllers, isolated from every user room.
// Game changes come only from the visible phone UI; the observer socket is read-only.
import express from "express";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { WebSocket, WebSocketServer } from "ws";
import { createServer as createViteServer } from "vite";
import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { RoomHub } from "../src/hub.js";
import { sampleThrow, upperDieFace } from "../src/throw-motion.js";
import { openAdminSection } from "./helpers/admin-controls.mjs";

const code = "BOTQA2",
  hub = new RoomHub(code),
  app = express(),
  server = createServer(app);
const sockets = new WebSocketServer({
  server,
  path: "/socket",
  maxPayload: 8192,
});
const errors = [],
  states = [];
let origin, browser, observer, vite, latest;
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
app.get("/api/config", (_req, res) =>
  res.json({ local: true, code, joinOrigin: origin, lanOrigin: origin }),
);
sockets.on("connection", (socket, req) => {
  if (
    req.headers.origin &&
    new URL(req.headers.origin).host !== req.headers.host
  ) {
    socket.close(1008, "Origin not allowed");
    return;
  }
  const id = randomUUID();
  hub.connect(id, (message) => {
    if (socket.readyState === WebSocket.OPEN)
      socket.send(JSON.stringify(message));
  });
  socket.on("message", (raw) => {
    try {
      hub.receive(id, JSON.parse(raw));
    } catch {
      socket.send(
        JSON.stringify({ type: "error", message: "Invalid message." }),
      );
    }
  });
  socket.on("close", () => hub.disconnect(id));
  socket.on("error", () => socket.close());
});
async function waitState(predicate, label, timeout = 15000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    if (latest && predicate(latest)) return structuredClone(latest);
    await pause(20);
  }
  throw Error(
    `Timed out waiting for ${label}; latest status=${latest?.status}, shooter=${latest?.shooterId}, rolling=${latest?.rolling}`,
  );
}
function observePage(page) {
  page.on("pageerror", (error) => errors.push(error.message));
}
async function join(page, name) {
  await page.goto(`${origin}/join?code=${code}`);
  await page.getByLabel("Your name").fill(name);
  await page.getByRole("button", { name: "Join", exact: true }).click();
}
async function addBot(page, { name, strategy, difficulty }) {
  await openAdminSection(page, "Players");
  await page.getByRole("button", { name: "Add bot", exact: true }).click();
  await page.getByLabel("Bot name", { exact: true }).fill(name);
  await page.getByRole("button", { name: strategy, exact: true }).click();
  await page.getByRole("button", { name: difficulty, exact: true }).click();
  await page.getByRole("button", { name: "Add to table", exact: true }).click();
  await expect(page.locator(".ha-roster")).toContainText(name);
}
try {
  vite = await createViteServer({
    cacheDir: "artifacts/bots-vite-cache",
    server: { middlewareMode: true, hmr: false },
    appType: "spa",
  });
  app.use(vite.middlewares);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  origin = `http://127.0.0.1:${server.address().port}`;
  observer = new WebSocket(`${origin.replace("http", "ws")}/socket`);
  observer.on("message", (raw) => {
    const message = JSON.parse(raw);
    if (message.type === "state") {
      latest = message.state;
      states.push({ at: Date.now(), state: message.state });
    } else if (message.type === "error") errors.push(message.message);
  });
  await new Promise((resolve) =>
    observer.once("open", () => {
      observer.send(JSON.stringify({ type: "watch" }));
      resolve();
    }),
  );
  browser = await chromium.launch({ headless: true, args: ["--disable-gpu"] });
  const hostContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
  });
  const guestContext = await browser.newContext({
    viewport: { width: 375, height: 812 },
    isMobile: true,
  });
  const host = await hostContext.newPage(),
    guest = await guestContext.newPage();
  observePage(host);
  observePage(guest);
  await join(host, "Human host");
  await host
    .getByRole("heading", { name: "Table setup", exact: true })
    .waitFor();
  const human = await waitState(
    (s) => s.players.some((p) => p.name === "Human host"),
    "host joined",
  );
  const hostId = human.adminId;
  assert.equal(human.config.botRollDelaySeconds, 5);
  await addBot(host, {
    name: "Ada",
    strategy: "Pass & odds",
    difficulty: "Regular",
  });
  await addBot(host, {
    name: "Bea",
    strategy: "Six & eight",
    difficulty: "Advanced",
  });
  const botsAdded = await waitState(
    (s) => s.players.filter((p) => p.bot && !p.left).length === 2,
    "both bots seated",
  );
  const ada = botsAdded.players.find((p) => p.name === "Ada"),
    bea = botsAdded.players.find((p) => p.name === "Bea");
  assert.deepEqual(ada.bot, { strategy: "line", difficulty: "regular" });
  assert.deepEqual(bea.bot, { strategy: "six-eight", difficulty: "expert" });
  assert.equal(botsAdded.adminId, hostId);
  await join(guest, "Human guest");
  await guest.getByText("Your chips are waiting.", { exact: true }).waitFor();
  const seated = await waitState(
    (s) => s.players.filter((p) => !p.left).length === 4,
    "guest seated",
  );
  const guestId = seated.players.find((p) => p.name === "Human guest").id;
  assert.deepEqual(
    seated.players.map((p) => p.name),
    ["Human host", "Ada", "Bea", "Human guest"],
  );
  await openAdminSection(host, "Table");
  await host.getByLabel("Betting window (seconds)").fill("0");
  await expect(host.getByLabel("Bot roll delay (seconds)")).toHaveValue("5");
  await host
    .getByRole("button", { name: "Open the table", exact: true })
    .click();
  const betting = await waitState(
    (s) =>
      s.status === "playing" &&
      s.players.filter((p) => p.bot).every((p) => p.bets.length > 0),
    "ordinary bot bets",
  );
  assert.equal(betting.shooterId, hostId);
  assert.equal(betting.config.rollCooldownSeconds, 0);
  assert.equal(betting.config.botRollDelaySeconds, 5);
  assert(
    betting.players
      .filter((p) => p.bot)
      .every((p) => p.bank < betting.config.startingBank),
  );
  // The human host leaves voluntarily. Existing production rotation hands the
  // dice to Ada and host controls to the next human, never to either bot.
  await openAdminSection(host, "Table");
  await host.locator(".ha-management>summary").click();
  await host
    .getByRole("button", { name: "Cash out & leave", exact: true })
    .click();
  await host.getByRole("button", { name: "Cash out", exact: true }).click();
  const handoff = await waitState(
    (s) => s.adminId === guestId && s.shooterId === ada.id && s.botRollAt > 0,
    "human host handoff and bot timer",
  );
  const deadline = handoff.botRollAt;
  const turnState = states.find(
    (entry) =>
      entry.state.adminId === guestId &&
      entry.state.shooterId === ada.id &&
      entry.state.botRollAt === deadline,
  );
  assert(
    deadline - turnState.at >= 4800 && deadline - turnState.at <= 5100,
    "Bot gets five real extra seconds after turn assignment",
  );
  await openAdminSection(guest, "Players");
  await guest
    .locator(".ha-disclosure>summary")
    .filter({ hasText: "Pass host controls" })
    .click();
  const transferChoices = await guest
    .getByLabel("Pass host controls", { exact: true })
    .count();
  assert.equal(
    transferChoices,
    0,
    "Only remaining human is host; bots cannot appear in transfer choices",
  );
  if (Date.now() < deadline - 250) {
    await pause(Math.max(0, deadline - 250 - Date.now()));
    assert.equal(
      latest.rolling,
      false,
      "Bot has not rolled before its delay expires",
    );
  }
  const rolling = await waitState(
    (s) => s.rolling && s.throw?.playerId === ada.id,
    "automatic physical bot roll",
    12000,
  );
  const observedRoll = states.find(
    (entry) =>
      entry.state.throw?.id === rolling.throw.id && entry.state.rolling,
  );
  assert(observedRoll.at >= deadline - 5, "No early automatic throw");
  assert(rolling.throw.frames.length > 20);
  assert(rolling.throw.duration >= 2000);
  await guest
    .getByRole("button", { name: "Close settings", exact: true })
    .click();
  const settled = await waitState(
    (s) => !s.rolling && s.lastRoll?.throwId === rolling.throw.id,
    "physical bot roll settled",
    10000,
  );
  assert.deepEqual(settled.lastRoll.dice, rolling.throw.dice);
  const finalPose = sampleThrow(
    rolling.throw,
    rolling.throw.startAt + rolling.throw.duration,
  );
  finalPose.dice.forEach((die, index) => {
    const face = upperDieFace(die.quaternion);
    assert(face.alignment > 0.99);
    assert.equal(face.value, settled.lastRoll.dice[index]);
  });
  assert.equal(settled.adminId, guestId);
  await openAdminSection(guest, "Players");
  await guest.getByRole("button", { name: "Remove Bea", exact: true }).click();
  await waitState(
    (s) => s.players.find((p) => p.id === bea.id)?.left,
    "guest admin removes bot",
  );
  await openAdminSection(guest, "Table");
  await guest.locator(".ha-management>summary").click();
  await guest
    .getByRole("button", { name: "Close table for everyone", exact: true })
    .click();
  await guest
    .getByRole("button", { name: "Close for everyone", exact: true })
    .click();
  const closed = await waitState(
    (s) => s.status === "ended",
    "admin closes table",
  );
  assert.equal(closed.botRollAt, null);
  await guest.getByText("THE TABLE IS CLOSED", { exact: true }).waitFor();
  await mkdir("artifacts/bots", { recursive: true });
  await guest.screenshot({
    path: "artifacts/bots/closed-recap.png",
    fullPage: true,
  });
  assert.deepEqual(errors, []);
  const report = {
    authority: "Real RoomHub with real timers and recorded Cannon physics",
    room: code,
    players: seated.players.map(({ name, bot }) => ({ name, bot })),
    config: betting.config,
    botBetCounts: betting.players
      .filter((p) => p.bot)
      .map((p) => ({ name: p.name, bets: p.bets.length })),
    botDeadline: deadline,
    observedRollAt: observedRoll.at,
    extraDelayMs: deadline - turnState.at,
    throwFrames: rolling.throw.frames.length,
    dice: settled.lastRoll.dice,
    finalStatus: closed.status,
    errors,
  };
  await writeFile(
    "artifacts/bots/browser-report.json",
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report));
} finally {
  hub.close();
  observer?.terminate();
  await browser?.close();
  for (const socket of sockets.clients) socket.terminate();
  await new Promise((resolve) => sockets.close(resolve));
  await new Promise((resolve) => server.close(resolve));
  await vite?.close();
}
