import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import {
  MAX_JUKEBOX_QUEUE,
  restoreJukeboxSettings,
  updateJukeboxSettings,
} from "../src/jukebox-settings.js";

const run = promisify(execFile);
const videoId = /^[A-Za-z0-9_-]{11}$/;
const titleLimit = 160;
const searchLimit = 8;
const maxDuration = 15 * 60;
const resultLifetime = 5 * 60_000;
const videoStartTimeout = 45_000;

export function youtubeTracks(data) {
  const tracks = new Map();
  for (const entry of Array.isArray(data?.entries) ? data.entries : []) {
    if (
      typeof entry?.id !== "string" ||
      !videoId.test(entry.id) ||
      typeof entry.title !== "string" ||
      !entry.title.trim() ||
      !Number.isFinite(entry.duration) ||
      entry.duration <= 0 ||
      entry.duration > maxDuration ||
      entry.live_status === "is_live" ||
      entry.live_status === "is_upcoming"
    )
      continue;
    tracks.set(entry.id, {
      id: entry.id,
      title: entry.title.trim().slice(0, titleLimit),
      artist: String(entry.channel || entry.uploader || "").slice(
        0,
        titleLimit,
      ),
      duration: Math.round(entry.duration),
    });
    if (tracks.size >= searchLimit) break;
  }
  return [...tracks.values()];
}

export function nativeMusic({
  mpv = "mpv",
  ytdlp = "yt-dlp",
  volume = 35,
} = {}) {
  const level = Number.isFinite(volume)
    ? Math.max(0, Math.min(100, volume))
    : 35;
  return {
    async search(query, signal) {
      try {
        const { stdout } = await run(
          ytdlp,
          [
            "--ignore-config",
            "--flat-playlist",
            "--dump-single-json",
            "--quiet",
            "--no-warnings",
            "--socket-timeout",
            "8",
            "--retries",
            "0",
            "--",
            `ytsearch${searchLimit}:${query}`,
          ],
          {
            signal,
            timeout: 20_000,
            maxBuffer: 1024 * 1024,
            windowsHide: true,
          },
        );
        return youtubeTracks(JSON.parse(stdout));
      } catch (error) {
        if (error.code === "ENOENT")
          throw Error("Install yt-dlp on the desktop host to search YouTube.");
        throw Error("YouTube search is unavailable. Try again in a moment.");
      }
    },
    play(track) {
      if (!videoId.test(track.id)) throw Error("Invalid YouTube video.");
      const child = spawn(
        mpv,
        [
          "--no-config",
          "--load-scripts=no",
          "--vid=no",
          "--audio-display=no",
          "--force-window=no",
          "--no-resume-playback",
          "--network-timeout=15",
          `--volume=${level}`,
          `--script-opt=ytdl_hook-ytdl_path=${ytdlp}`,
          "--ytdl-raw-options=ignore-config=,no-playlist=,socket-timeout=8,retries=0",
          "--",
          `https://www.youtube.com/watch?v=${track.id}`,
        ],
        { stdio: "ignore", windowsHide: true },
      );
      let failure, killTimer;
      const done = new Promise((resolve) => {
        const playbackTimer = setTimeout(
          () => {
            failure = "Playback timed out.";
            stop();
          },
          (track.duration + 90) * 1000,
        );
        playbackTimer.unref();
        child.once("error", (error) => {
          failure =
            error.code === "ENOENT"
              ? "Install mpv on the desktop host to play requests."
              : "mpv could not start playback.";
        });
        child.once("close", (code) => {
          clearTimeout(playbackTimer);
          clearTimeout(killTimer);
          resolve(
            failure ||
              (code === 0 ? null : "YouTube could not play this track."),
          );
        });
      });
      function stop() {
        if (killTimer || child.exitCode !== null || child.signalCode !== null)
          return;
        child.kill("SIGTERM");
        killTimer = setTimeout(() => child.kill("SIGKILL"), 1500);
        killTimer.unref();
      }
      return { done, stop };
    },
  };
}

export class DesktopJukebox {
  constructor(backend, { enabled = false } = {}) {
    this.backend = backend;
    this.onChange = () => {};
    this.onBalance = () => {};
    this.balanceChanged = false;
    this.searches = new Map();
    this.pendingSearches = new Map();
    this.queue = [];
    this.current = null;
    this.active = null;
    this.videoDisplay = null;
    this.notice = null;
    this.defaultSettings = restoreJukeboxSettings({ enabled });
    this.settings = { ...this.defaultSettings };
  }

  snapshot(joined, clientId) {
    const state = { playing: !!this.current };
    if (
      this.settings.enabled &&
      (this.current || this.queue.length || this.notice)
    )
      state.tv = {
        title: this.current?.title ?? null,
        next: this.queue.find((track) => !track.pending)?.title ?? null,
        queued: this.queue.length,
        failed: !!this.notice,
      };
    if (
      this.settings.enabled &&
      clientId &&
      clientId === this.videoDisplay &&
      this.active?.video
    )
      state.video = this.active.video;
    if (joined)
      Object.assign(state, {
        ...this.settings,
        current: this.current,
        queue: this.queue.slice(),
        notice: this.notice,
      });
    return state;
  }

  setVideoDisplay(id) {
    if (this.videoDisplay === id) return;
    this.videoDisplay = id;
    if (this.active?.video && !id) this.active.report("error");
    this.publish();
  }

  reportVideo(id, attempt, status) {
    if (id === this.videoDisplay && this.active?.video?.attempt === attempt)
      this.active.report(status);
  }

  async search(player, query, stillJoined) {
    const term = typeof query === "string" ? query.trim() : "";
    if (term.length < 2 || term.length > 100)
      throw Error("Enter 2–100 characters to search.");
    this.requireRequests();
    const now = Date.now();
    for (const [id, result] of this.searches)
      if (Math.max(result.after, result.expires) < now)
        this.searches.delete(id);
    if (
      this.pendingSearches.has(player.id) ||
      (this.searches.get(player.id)?.after ?? 0) > now
    )
      throw Error("Wait a moment before searching again.");
    if (this.pendingSearches.size >= 2)
      throw Error("The jukebox is searching. Try again in a moment.");
    const cancel = new AbortController();
    this.pendingSearches.set(player.id, cancel);
    this.searches.set(player.id, {
      after: now + 2_000,
      expires: 0,
      tracks: [],
    });
    try {
      const tracks = await this.backend.search(term, cancel.signal);
      if (cancel.signal.aborted || !stillJoined()) return null;
      this.searches.set(player.id, {
        after: now + 2_000,
        expires: Date.now() + resultLifetime,
        tracks,
      });
      return tracks;
    } finally {
      if (this.pendingSearches.get(player.id) === cancel)
        this.pendingSearches.delete(player.id);
    }
  }

  request(player, id, isHost, quotedCost) {
    this.requireRequests();
    const result = this.searches.get(player.id);
    const track =
      result?.expires > Date.now()
        ? result.tracks.find((entry) => entry.id === id)
        : null;
    if (!track) throw Error("Search again to request this track.");
    if (this.current?.id === id || this.queue.some((entry) => entry.id === id))
      throw Error("That track is already queued.");
    if (
      this.queue.length >= MAX_JUKEBOX_QUEUE ||
      this.queue.filter((entry) => entry.requesterId === player.id).length >=
        this.settings.limit
    )
      throw Error(
        "Your request limit has been reached. Try again after a song plays.",
      );
    const cost = this.settings.cost;
    if (quotedCost !== cost)
      throw Error(
        "The song price changed. Review the new price and try again.",
      );
    this.changeBalance(player.id, -cost);
    this.queue.push({
      ...track,
      requesterId: player.id,
      requester: player.name,
      cost,
      pending: this.settings.mode === "approval" && !isHost,
    });
    this.advance();
    this.publish();
  }

  requireRequests() {
    if (!this.settings.enabled) throw Error("Music mode is off.");
    if (this.settings.mode === "off")
      throw Error("The host paused music requests.");
  }

  changeBalance(playerId, amount) {
    if (amount) {
      this.onBalance(playerId, amount);
      this.balanceChanged = true;
    }
  }

  refund(track) {
    this.changeBalance(track.requesterId, track.cost);
  }

  publish() {
    const changed = this.balanceChanged;
    this.balanceChanged = false;
    this.onChange(changed);
  }

  control(message) {
    if (message.action === "mode") {
      this.settings = updateJukeboxSettings(this.settings, {
        mode: message.mode,
      });
    } else if (message.action === "settings") {
      this.settings = updateJukeboxSettings(this.settings, message.settings);
      if (!this.settings.enabled) {
        this.cancelSearches();
        this.clear();
        return;
      }
    } else if (message.action === "skip") {
      this.stopCurrent();
      return;
    } else if (message.action === "clear") {
      this.clear();
      return;
    } else if (
      ["approve", "remove", "move-up", "move-down"].includes(message.action)
    ) {
      const index = this.queue.findIndex(
        (track) => track.id === message.trackId,
      );
      if (index === -1) throw Error("That request is no longer in the queue.");
      if (message.action === "approve") this.queue[index].pending = false;
      else if (message.action === "remove") {
        const [track] = this.queue.splice(index, 1);
        this.refund(track);
      } else {
        const target = index + (message.action === "move-up" ? -1 : 1);
        if (target < 0 || target >= this.queue.length) return;
        [this.queue[index], this.queue[target]] = [
          this.queue[target],
          this.queue[index],
        ];
      }
    } else throw Error("Unknown jukebox control.");
    this.advance();
    this.publish();
  }

  advance() {
    if (this.active) return;
    const index = this.queue.findIndex((track) => !track.pending);
    if (index === -1) return;
    const [track] = this.queue.splice(index, 1);
    this.current = track;
    try {
      this.followPlayback(track, this.backend.play(track));
    } catch {
      if (!this.startVideo(track))
        this.finishTrack(track, "mpv could not start playback.");
    }
  }

  startVideo(track) {
    if (!this.videoDisplay) return false;
    const video = { id: track.id, attempt: randomUUID() };
    let resolve, timer;
    const done = new Promise((done) => {
      resolve = done;
    });
    const finish = (error) => {
      clearTimeout(timer);
      resolve(error);
    };
    const expire = (wait) => {
      clearTimeout(timer);
      timer = setTimeout(() => finish("The YouTube player timed out."), wait);
      timer.unref();
    };
    expire(videoStartTimeout);
    this.followPlayback(track, {
      video,
      done,
      stop: () => finish(null),
      report(status) {
        if (status === "playing") expire((track.duration + 180) * 1000);
        else if (status === "ended") finish(null);
        else if (status === "error")
          finish("The YouTube player could not play this track.");
      },
    });
    return true;
  }

  followPlayback(track, playback) {
    const active = { ...playback, stopped: false };
    this.active = active;
    active.done.then((error) => {
      if (this.active !== active) return;
      if (!active.stopped && error && !active.video && this.startVideo(track)) {
        this.publish();
        return;
      }
      this.finishTrack(track, error, active.stopped);
      this.publish();
    });
  }

  finishTrack(track, error, stopped = false) {
    if (!stopped) {
      if (error) this.refund(track);
      this.notice = error ? `${track.title} was skipped. ${error}` : null;
    }
    this.active = this.current = null;
    this.advance();
  }

  stopCurrent() {
    if (this.active && !this.active.stopped) {
      this.active.stopped = true;
      this.active.stop();
    }
  }

  clear({ refund = true } = {}) {
    if (refund) for (const track of this.queue) this.refund(track);
    this.queue = [];
    this.notice = null;
    this.stopCurrent();
    this.publish();
  }

  cancelSearches() {
    for (const search of this.pendingSearches.values()) search.abort();
    this.pendingSearches.clear();
    this.searches.clear();
  }

  removePlayer(id) {
    this.pendingSearches.get(id)?.abort();
    this.searches.delete(id);
    const retained = [];
    for (const track of this.queue) {
      if (track.requesterId === id) this.refund(track);
      else retained.push(track);
    }
    this.queue = retained;
    this.publish();
  }

  reset({ refund = true, restoreDefaults = true } = {}) {
    this.cancelSearches();
    if (restoreDefaults) this.settings = { ...this.defaultSettings };
    this.clear({ refund });
  }

  close() {
    this.reset();
    return this.active?.done;
  }
}
