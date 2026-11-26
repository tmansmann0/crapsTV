import assert from "node:assert/strict";
import test from "node:test";
import { DesktopJukebox, youtubeTracks } from "../server/desktop-jukebox.js";
import { RoomHub } from "../src/hub.js";

const first = {
  id: "0A1B2C3D4E5",
  title: "First track",
  artist: "Artist",
  duration: 110,
};
const second = { ...first, id: "1B2C3D4E5F6", title: "Second track" };
const next = () => new Promise(setImmediate);

test("YouTube results admit bounded song metadata and ignore streams and playlists", () => {
  assert.deepEqual(
    youtubeTracks({
      entries: [
        { ...first, channel: first.artist },
        { ...second, id: "PL-too-long-for-a-video" },
        { ...second, duration: null },
        { ...second, live_status: "is_live" },
        { ...second, duration: 3600 },
        { ...first, channel: first.artist },
      ],
    }),
    [first],
  );
});

test("desktop jukebox protects transport controls, shares the queue and advances one player at a time", async (t) => {
  const played = [];
  const jukebox = new DesktopJukebox({
    search: async () => [first, second],
    play(track) {
      let finish;
      const done = new Promise((resolve) => {
        finish = resolve;
      });
      const playback = { track, finish, done, stopped: false };
      played.push(playback);
      return {
        done,
        stop: () => {
          playback.stopped = true;
        },
      };
    },
  });
  const hub = new RoomHub("MUSIC1", { jukebox });
  t.after(() => {
    played.forEach((playback) => playback.finish(null));
    return hub.close();
  });

  const inboxes = {};
  for (const id of ["host", "guest", "tv"]) {
    inboxes[id] = [];
    hub.connect(id, (message) => inboxes[id].push(message));
  }
  const last = (id, type) =>
    inboxes[id].findLast((message) => message.type === type);
  const send = (id, type, data = {}) => hub.receive(id, { type, ...data });
  send("tv", "jukebox-search", { query: "jazz" });
  assert.match(last("tv", "jukebox-error").message, /Join an open table/);
  send("host", "join", { name: "Host", code: "MUSIC1" });
  send("guest", "join", { name: "Guest", code: "MUSIC1" });
  const guest = hub.state.players.find((player) => player.name === "Guest");
  const initial = guest.bank;
  const details = last("host", "jukebox-state").jukebox;
  assert.equal(details.enabled, false);
  assert.equal(details.cost, 500);
  assert.equal(details.limit, 3);
  send("host", "jukebox-control", {
    action: "settings",
    settings: { enabled: true },
  });
  send("host", "start");

  send("guest", "jukebox-control", { action: "mode", mode: "approval" });
  assert.match(last("guest", "jukebox-error").message, /Only the table host/);
  send("host", "jukebox-control", { action: "mode", mode: "approval" });
  send("guest", "jukebox-request", { trackId: first.id, cost: 500 });
  assert.match(last("guest", "jukebox-error").message, /Search again/);

  send("guest", "jukebox-search", { query: "jazz" });
  await next();
  assert.deepEqual(last("guest", "jukebox-results").tracks, [first, second]);
  assert.equal(last("tv", "jukebox-results"), undefined);
  send("guest", "jukebox-request", { trackId: first.id, cost: 500 });
  send("guest", "jukebox-request", { trackId: second.id, cost: 500 });
  assert.equal(played.length, 0);
  assert.equal(guest.bank, initial - 1000);
  assert.equal(last("host", "jukebox-state").jukebox.queue[0].pending, true);

  send("host", "jukebox-control", { action: "move-up", trackId: second.id });
  assert.deepEqual(
    last("host", "jukebox-state").jukebox.queue.map((track) => track.id),
    [second.id, first.id],
  );
  send("host", "jukebox-control", { action: "approve", trackId: second.id });
  send("host", "jukebox-control", { action: "approve", trackId: first.id });
  assert.equal(played.length, 1);
  assert.equal(
    last("host", "jukebox-state").jukebox.current.title,
    second.title,
  );
  assert.deepEqual(last("tv", "jukebox-state").jukebox, { playing: true });
  send("host", "jukebox-control", { action: "skip" });
  assert.equal(played[0].stopped, true);
  assert.equal(played.length, 1);
  played[0].finish("mpv exited");
  await next();
  assert.equal(played.length, 2);
  assert.equal(
    last("guest", "jukebox-state").jukebox.current.title,
    first.title,
  );

  played[1].finish("The video is unavailable.");
  await next();
  assert.match(
    last("guest", "jukebox-state").jukebox.notice,
    /First track was skipped/,
  );
  assert.equal(guest.bank, initial - 500);
  assert.deepEqual(last("tv", "jukebox-state").jukebox, { playing: false });
});

test("clearing a room aborts an unfinished lookup and reports no stale results", async () => {
  let cancel;
  let finish;
  const jukebox = new DesktopJukebox({
    search(query, signal) {
      cancel = signal;
      return new Promise((resolve) => {
        finish = resolve;
      });
    },
  });
  jukebox.control({ action: "settings", settings: { enabled: true } });
  const pending = jukebox.search({ id: "player" }, "jazz", () => true);
  jukebox.reset();
  assert.equal(cancel.aborted, true);
  finish([first]);
  assert.equal(await pending, null);
  jukebox.control({ action: "settings", settings: { enabled: true } });
  assert.throws(
    () => jukebox.request({ id: "player" }, first.id, false),
    /Search again/,
  );
});

test("price and queue limits apply to new requests and saved tables refund queued chips once", async (t) => {
  const jukebox = new DesktopJukebox({ search: async () => [first, second] });
  let saved;
  let fail = true;
  const hub = new RoomHub("MUSIC2", {
    jukebox,
    saveStore: {
      write(save) {
        if (fail) throw Error("Storage unavailable");
        saved = save;
      },
    },
  });
  t.after(() => hub.close());
  const messages = [];
  const send = (id, type, values = {}) => hub.receive(id, { type, ...values });
  for (const id of ["Host", "Guest"]) {
    hub.connect(id, (message) => messages.push(message));
    send(id, "join", { name: id, code: "MUSIC2" });
  }
  const change = (settings) =>
    send("Host", "jukebox-control", { action: "settings", settings });
  change({ enabled: true, mode: "approval", cost: 700, limit: 1 });
  send("Host", "start");
  send("Guest", "jukebox-search", { query: "jazz" });
  await next();
  const player = () => hub.state.players.find((p) => p.name === "Guest");
  const initial = player().bank;
  const request = (track, cost) =>
    send("Guest", "jukebox-request", { trackId: track.id, cost });

  request(first, 500);
  assert.match(messages.at(-1).message, /song price changed/);
  request(first, 700);
  request(second, 700);
  assert.match(messages.at(-1).message, /request limit/);
  assert.equal(player().bank, initial - 700);

  change({ cost: 900 });
  send("Host", "save-session");
  assert.match(messages.at(-1).message, /could not be saved/);
  assert.equal(jukebox.queue.length, 1);
  assert.equal(player().bank, initial - 700);
  fail = false;
  send("Host", "save-session");
  assert.equal(jukebox.queue.length, 0);
  assert.equal(player().bank, initial);
  assert.equal(saved.state.jukeboxSettings.cost, 900);
  assert.equal(saved.state.jukeboxSettings.limit, 1);
});
