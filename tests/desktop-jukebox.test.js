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

  send("guest", "jukebox-control", { action: "mode", mode: "approval" });
  assert.match(last("guest", "jukebox-error").message, /Only the table host/);
  send("host", "jukebox-control", { action: "mode", mode: "approval" });
  send("guest", "jukebox-request", { trackId: first.id });
  assert.match(last("guest", "jukebox-error").message, /Search again/);

  send("guest", "jukebox-search", { query: "jazz" });
  await next();
  assert.deepEqual(last("guest", "jukebox-results").tracks, [first, second]);
  assert.equal(last("tv", "jukebox-results"), undefined);
  send("guest", "jukebox-request", { trackId: first.id });
  send("guest", "jukebox-request", { trackId: second.id });
  assert.equal(played.length, 0);
  assert.equal(last("host", "jukebox-state").state.queue[0].pending, true);

  send("host", "jukebox-control", { action: "approve", trackId: first.id });
  send("host", "jukebox-control", { action: "approve", trackId: second.id });
  assert.equal(played.length, 1);
  assert.equal(last("host", "jukebox-state").state.current.title, first.title);
  assert.deepEqual(last("tv", "jukebox-state").state, { playing: true });
  send("host", "jukebox-control", { action: "skip" });
  assert.equal(played[0].stopped, true);
  assert.equal(played.length, 1);
  played[0].finish("mpv exited");
  await next();
  assert.equal(played.length, 2);
  assert.equal(
    last("guest", "jukebox-state").state.current.title,
    second.title,
  );

  played[1].finish("The video is unavailable.");
  await next();
  assert.match(
    last("guest", "jukebox-state").state.notice,
    /Second track was skipped/,
  );
  assert.deepEqual(last("tv", "jukebox-state").state, { playing: false });
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
  const pending = jukebox.search({ id: "player" }, "jazz", () => true);
  jukebox.reset();
  assert.equal(cancel.aborted, true);
  finish([first]);
  assert.equal(await pending, null);
  assert.throws(
    () => jukebox.request({ id: "player" }, first.id, false),
    /Search again/,
  );
});
