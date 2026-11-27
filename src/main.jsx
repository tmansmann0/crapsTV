import { assetURL } from "./asset-url.js";
import React, { lazy, Suspense, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowRight,
  BookOpen,
  Check,
  ChevronDown,
  Crown,
  Dices,
  Info,
  LogOut,
  Minus,
  Monitor,
  Music2,
  Plus,
  RefreshCw,
  Smartphone,
  Sparkles,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { routeInfo, controllerURL } from "./routes.js";
import { DEFAULT_GRAPHICS, GRAPHICS_OPTIONS } from "./graphics-settings.js";
import { HOUSE_RULES } from "./house-rules.js";
import HouseRuleShowcase, {
  HouseRuleChanceShowcase,
  useHouseRuleShowcase,
} from "./HouseRuleShowcase.jsx";
import { DESKTOP_DISPLAY } from "./display-build.js";
const TableScene = lazy(() => import("./Table3D.jsx"));
const Jukebox = DESKTOP_DISPLAY ? lazy(() => import("./Jukebox.jsx")) : null;
const JukeboxVideo = DESKTOP_DISPLAY
  ? lazy(() => import("./JukeboxVideo.jsx"))
  : null;
const EMPTY_MUSIC_SEARCH = { pending: false, tracks: null, error: "" };
function JukeboxTVStatus({ music }) {
  return (
    <div className="jukebox-tv-status" role="status" aria-label="Table music">
      <Music2 size={16} aria-hidden="true" />
      <div>
        {music.title && <strong title={music.title}>{music.title}</strong>}
        {music.next ? (
          <span title={music.next}>Next · {music.next}</span>
        ) : music.queued ? (
          <span>Awaiting approval</span>
        ) : music.failed && !music.title ? (
          <span>Last song couldn’t play</span>
        ) : null}
      </div>
      {music.queued > 0 && <small>{music.queued} queued</small>}
    </div>
  );
}
function Table3D(props) {
  return (
    <Suspense
      fallback={<div className="table-canvas" aria-label="Loading 3D table" />}
    >
      <TableScene {...props} />
    </Suspense>
  );
}
import Recap from "./recap.jsx";
import PhoneGame from "./PhoneGame.jsx";
import DiceThrow from "./DiceThrow.jsx";
import AdminPanel from "./AdminPanel.jsx";
import TableAudioDialog from "./TableAudioDialog.jsx";
import SavedTable, { ReconnectSeat } from "./SavedTable.jsx";
import { normalizeTableAudio } from "./table-audio-settings.js";
import AndroidHostPanel from "./AndroidHostPanel.jsx";
import {
  createTableAudio,
  loadTableAudioSettings,
  saveTableAudioSettings,
} from "./table-audio.js";
import { catalogue, describeBet, money, equity, net } from "./game.js";
import { PHYSICS_VERSION } from "./throw-motion.js";
import {
  detectLocal,
  localTransport,
  onlineTransport,
  readOnlineRoomSave,
  newCode,
} from "./transport.js";
import "@fontsource/dm-sans/latin-400.css";
import "@fontsource/dm-sans/latin-500.css";
import "@fontsource/dm-sans/latin-600.css";
import "@fontsource/dm-sans/latin-700.css";
import "@fontsource/manrope/latin-400.css";
import "@fontsource/manrope/latin-500.css";
import "@fontsource/manrope/latin-600.css";
import "@fontsource/manrope/latin-700.css";
import "@fontsource/manrope/latin-800.css";
import "./style.css";
const base = import.meta.env.BASE_URL;
const getSaved = (key) => {
  try {
    return JSON.parse(localStorage.getItem(key) || "null");
  } catch {
    return null;
  }
};
const save = (key, value) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
};
const SESSION_CONFIRM = {
  end: {
    title: "Close the table?",
    detail:
      "Everyone gets their remaining chips back and a personal recap. This ends the session for all players.",
    button: "Close for everyone",
  },
  leave: {
    title: "Cash out for the night?",
    detail:
      "Your open bets are returned to your stack. Your recap is ready to save when you leave.",
    button: "Cash out",
  },
  "save-session": {
    title: "Save and close the table?",
    detail:
      "Play pauses with the same players, balances and bets. Once the table says it’s saved, you can close or update the host. Open this controller again to resume.",
    button: "Save and close",
  },
};
function Brand() {
  return (
    <a className="brand" href={document.baseURI} aria-label="crapsTV home">
      <img
        className="brand-logo"
        src={assetURL("brand-logo.png")}
        alt="crapsTV"
      />
    </a>
  );
}
function useAnnouncer(state, enabled, houseEnabled, showcase) {
  const manifest = useRef(null),
    last = useRef(null),
    lastLog = useRef(null),
    queue = useRef([]),
    playing = useRef(false),
    audio = useRef(null),
    audioChannel = useRef(null),
    latest = useRef({ enabled, houseEnabled });
  latest.current = { enabled, houseEnabled };
  useEffect(() => {
    fetch(`${base}audio/manifest.json`)
      .then((r) => r.json())
      .then((m) => {
        manifest.current = m;
        play();
      })
      .catch(() => {});
    return () => {
      audio.current?.pause();
    };
  }, []);
  function play() {
    if (!manifest.current || playing.current || !queue.current.length) return;
    const key = queue.current.shift(),
      entry = manifest.current?.[key];
    const channel = key.startsWith("house-") ? "houseEnabled" : "enabled";
    if (!entry || !latest.current[channel]) {
      play();
      return;
    }
    const a = new Audio(`${base}audio/${entry.file}`);
    audio.current = a;
    audioChannel.current = channel;
    playing.current = true;
    a.onended = a.onerror = () => {
      playing.current = false;
      play();
    };
    a.play().catch(() => {
      if (audio.current !== a) return;
      playing.current = false;
      queue.current = [];
    });
  }
  function stop() {
    if (audio.current) {
      audio.current.onended = null;
      audio.current.onerror = null;
      audio.current.pause();
    }
    audio.current = null;
    audioChannel.current = null;
    playing.current = false;
  }
  useEffect(() => {
    if (enabled) {
      if (!showcase) {
        queue.current.push("welcome");
        play();
      }
    } else {
      if (audioChannel.current === "enabled") stop();
      queue.current = queue.current.filter((key) => key.startsWith("house-"));
    }
  }, [enabled]);
  useEffect(() => {
    const clip = houseEnabled && showcase && HOUSE_RULES[showcase.rule]?.clip;
    if (clip) {
      stop();
      queue.current = [clip];
    } else {
      if (audioChannel.current === "houseEnabled") stop();
      queue.current = queue.current.filter((key) => !key.startsWith("house-"));
    }
    play();
  }, [showcase, houseEnabled]);
  useEffect(() => {
    if (!state) return;
    const signature = `${state.status}:${state.rolling ? "rolling" : state.lastRoll?.id || ""}`,
      previous = last.current;
    last.current = signature;
    const newest = state.log[0],
      priorLog = lastLog.current;
    lastLog.current = newest?.id;
    if ((!enabled && !houseEnabled) || previous === null) return;
    if (newest?.id !== priorLog) {
      const key = {
        "player-joined": "player-joined",
        leave: "player-left",
        reup: "re-up",
        "teach-mode": "teach-mode",
      }[newest?.type];
      if (enabled && key) queue.current.push(key);
    }
    if (enabled && !showcase && signature !== previous) {
      if (state.rolling) queue.current.push("bets-locked");
      else if (state.status === "ended") queue.current.push("session-ended");
      else if (state.lastRoll) {
        queue.current.push(`roll-${state.lastRoll.total}`);
        if (state.lastRoll.kind !== "roll")
          queue.current.push(state.lastRoll.kind);
        if (state.lastRoll.kind === "point-set")
          queue.current.push(`point-${state.lastRoll.total}`);
        if (
          state.lastRoll.events.some((e) => e.delta >= state.config.minBet * 20)
        )
          queue.current.push("big-win");
        if (
          state.players.some((p) => !p.left && equity(p) < state.config.minBet)
        )
          queue.current.push("bust");
        queue.current.push("betting-open");
      } else if (state.status === "playing") queue.current.push("game-started");
    }
    play();
  }, [state, enabled, houseEnabled, showcase]);
}
function App() {
  const route = useRef(routeInfo()).current;
  const initialCode = route.code;
  const [session, setSession] = useState(null),
    [checking, setChecking] = useState(true),
    [state, setState] = useState(null),
    [view, setView] = useState(route.controller ? "phone" : "tv"),
    [playerId, setPlayerId] = useState(null),
    [status, setStatus] = useState("connecting"),
    [error, setError] = useState(""),
    [dismissedHostCode, setDismissedHostCode] = useState(""),
    [sound, setSound] = useState(false),
    [settingsOpen, setSettingsOpen] = useState(false),
    [audioOpen, setAudioOpen] = useState(false),
    [adminAudio, setAdminAudio] = useState(null),
    [androidPanel, setAndroidPanel] = useState(null),
    [audioReady, setAudioReady] = useState(false),
    [audioSettings, setAudioSettings] = useState(loadTableAudioSettings),
    [jukebox, setJukebox] = useState(null),
    [jukeboxOpen, setJukeboxOpen] = useState(false),
    [musicSearch, setMusicSearch] = useState(EMPTY_MUSIC_SEARCH),
    [tableAudio] = useState(createTableAudio),
    [joinName, setJoinName] = useState(""),
    [joinCode, setJoinCode] = useState(initialCode),
    [confirm, setConfirm] = useState(null);
  const androidHost = session?.android && location.hostname === "127.0.0.1";
  useEffect(() => {
    if (!androidHost || view !== "tv" || session.joinOrigin) return;
    // Android can publish its LAN address shortly after the local server is
    // reachable. Let one network refresh settle before opening the wizard.
    const timer = setTimeout(
      () => setAndroidPanel((current) => current || "setup"),
      2800,
    );
    return () => clearTimeout(timer);
  }, [androidHost, view, session?.joinOrigin]);
  useEffect(() => {
    if (!androidHost) return;
    const back = (event) => {
      if (androidPanel) setAndroidPanel(null);
      else if (audioOpen) setAudioOpen(false);
      else if (settingsOpen) setSettingsOpen(false);
      else return;
      event.preventDefault();
    };
    window.addEventListener("crapstv:back", back);
    return () => window.removeEventListener("crapstv:back", back);
  }, [androidHost, androidPanel, audioOpen, settingsOpen]);
  const confirmDialog = useRef(null);
  useEffect(() => {
    if (confirm) confirmDialog.current?.showModal();
  }, [confirm]);
  const transport = useRef(null),
    errorTimer = useRef(null);
  const toast = (message) => {
    setError(message);
    clearTimeout(errorTimer.current);
    errorTimer.current = setTimeout(() => setError(""), 7000);
  };
  useEffect(() => {
    let mounted = true;
    detectLocal().then((local) => {
      if (!mounted) return;
      if (local) {
        setSession({
          kind: "local",
          code: local.code,
          joinOrigin: local.joinOrigin,
          lanOrigin: local.lanOrigin,
          kiosk: local.kiosk === true,
          android: local.android === true,
        });
        setJoinCode(local.code);
      } else if (route.controller && initialCode) {
        setSession({ kind: "online-join", code: initialCode });
      } else if (!route.controller) {
        try {
          const restored = readOnlineRoomSave();
          setSession({
            kind: "online-host",
            code: restored?.state.code ?? newCode(),
            restored,
          });
        } catch (error) {
          // Keep an incompatible save intact so a newer app can recover it.
          setSession({ kind: "online-host", code: newCode(), canSave: false });
          toast(error.message);
        }
      }
      setChecking(false);
    });
    return () => {
      mounted = false;
      clearTimeout(errorTimer.current);
    };
  }, []);
  useEffect(() => {
    if (!androidHost || view !== "tv") return;
    let active = true;
    let timer;
    const refresh = async () => {
      const local = await detectLocal();
      if (!active) return;
      if (local?.android) {
        setSession((current) =>
          current?.android && current.joinOrigin !== local.joinOrigin
            ? {
                ...current,
                joinOrigin: local.joinOrigin,
                lanOrigin: local.lanOrigin,
              }
            : current,
        );
      }
      timer = setTimeout(refresh, 2500);
    };
    timer = setTimeout(refresh, 2500);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [androidHost, view]);
  useEffect(() => {
    if (!session) return;
    setState(null);
    setPlayerId(null);
    const key = `crapstv:${session.code}`;
    let clockOffset = null,
      bestRoundTrip = Infinity,
      clockStarted = false;
    const clockTimers = [];
    const onMessage = (m) => {
      if (m.type === "state") {
        if (!clockStarted && Object.hasOwn(m.state, "throw")) {
          clockStarted = true;
          for (const delay of [0, 250, 750])
            clockTimers.push(
              setTimeout(
                () =>
                  transport.current?.send({
                    type: "clock",
                    clientAt: Date.now(),
                  }),
                delay,
              ),
            );
        }
        const now = Date.now();
        const clockOffsetMs =
          clockOffset ?? (typeof m.sentAt === "number" ? m.sentAt - now : 0);
        if (m.state.rolling)
          tableAudio.scheduleLiveThrow(m.state.throw, now + clockOffsetMs);
        setState({
          ...m.state,
          snapshotAt: m.sentAt || now,
          clockOffsetMs,
        });
      } else if (m.type === "clock") {
        const now = Date.now(),
          roundTrip = now - m.clientAt;
        if (roundTrip >= 0 && roundTrip < bestRoundTrip) {
          bestRoundTrip = roundTrip;
          clockOffset = m.serverAt - (m.clientAt + now) / 2;
          setState((current) =>
            current ? { ...current, clockOffsetMs: clockOffset } : current,
          );
        }
      } else if (m.type === "welcome") {
        setPlayerId(m.playerId);
        const old = getSaved(key) || {};
        save(key, { ...old, token: m.token, playerId: m.playerId });
      } else if (DESKTOP_DISPLAY && m.type === "jukebox-state") {
        setJukebox(m.jukebox);
      } else if (DESKTOP_DISPLAY && m.type === "jukebox-results") {
        setMusicSearch({ pending: false, tracks: m.tracks, error: "" });
      } else if (DESKTOP_DISPLAY && m.type === "jukebox-error") {
        setMusicSearch((current) => ({
          ...current,
          pending: m.operation === "jukebox-search" ? false : current.pending,
          error: m.message,
        }));
      } else if (m.type === "error") toast(m.message);
      else if (m.type === "reset") {
        setPlayerId(null);
        if (DESKTOP_DISPLAY) {
          setJukeboxOpen(false);
          setMusicSearch(EMPTY_MUSIC_SEARCH);
        }
        save(key, null);
      }
    };
    const onStatus = (value) => {
      setStatus(value);
      if (DESKTOP_DISPLAY && value !== "connected")
        setMusicSearch((current) => ({ ...current, pending: false }));
      if (value !== "connected") tableAudio.scheduleLiveThrow(null);
      if (value === "connected") {
        clockStarted = false;
        const saved = getSaved(key);
        if (saved?.token)
          transport.current?.send({
            type: "join",
            code: session.code,
            token: saved.token,
            name: saved.name || "Player",
          });
        else transport.current?.send({ type: "watch" });
      }
    };
    transport.current =
      session.kind === "local"
        ? localTransport(onMessage, onStatus)
        : onlineTransport(
            session.code,
            session.kind === "online-host",
            onMessage,
            onStatus,
            { restored: session.restored, canSave: session.canSave },
          );
    return () => {
      clockTimers.forEach(clearTimeout);
      tableAudio.scheduleLiveThrow(null);
      transport.current?.close();
      transport.current = null;
    };
  }, [session?.kind, session?.code]);
  useEffect(() => {
    if (!DESKTOP_DISPLAY || session?.kind !== "local" || status !== "connected")
      return;
    let advertised;
    const advertise = () => {
      const ready = view === "tv" && innerWidth >= 320 && innerHeight >= 280;
      if (ready === advertised) return;
      advertised = ready;
      transport.current?.send({ type: "jukebox-display", ready });
    };
    advertise();
    if (view !== "tv") return;
    window.addEventListener("resize", advertise);
    return () => window.removeEventListener("resize", advertise);
  }, [session?.kind, status, view]);
  useEffect(() => {
    if (state?.display) setSound(state.display.sound);
  }, [state?.display?.revision]);
  const announceHouseRules =
    view === "tv" && state?.config.houseRules?.announce === true;
  const houseRulePrompt =
    status === "connected" && announceHouseRules ? state.houseRulePrompt : null;
  const houseRuleShowcase = useHouseRuleShowcase(
    status === "connected" ? state : null,
    announceHouseRules,
  );
  useAnnouncer(
    state,
    sound && view === "tv",
    announceHouseRules,
    houseRulePrompt ? null : houseRuleShowcase,
  );
  useEffect(() => {
    if (houseRulePrompt)
      tableAudio.houseRuleRoll(
        houseRulePrompt,
        Date.now() + (state.clockOffsetMs || 0),
      );
  }, [tableAudio, houseRulePrompt?.id, houseRulePrompt?.phase]);
  const audioRevision = state?.display?.audioRevision;
  useEffect(() => {
    if (view === "tv" && audioRevision)
      setAudioSettings(normalizeTableAudio(state.display.audio));
  }, [view, session?.code, audioRevision]);
  const jukeboxPlaying = DESKTOP_DISPLAY && jukebox?.playing === true;
  useEffect(() => {
    tableAudio.configure(
      jukeboxPlaying ? { ...audioSettings, musicVolume: 0 } : audioSettings,
    );
  }, [tableAudio, audioSettings, jukeboxPlaying]);
  useEffect(() => saveTableAudioSettings(audioSettings), [audioSettings]);
  useEffect(() => {
    if (view !== "tv") return;
    let active = true;
    const enable = () => {
      tableAudio.enable().then((ready) => {
        if (active && ready) setAudioReady(true);
      });
    };
    // Permissive kiosk displays can play immediately. Other browsers may
    // require the first interaction on this display before resuming audio.
    enable();
    window.addEventListener("pointerdown", enable);
    window.addEventListener("keydown", enable);
    return () => {
      active = false;
      window.removeEventListener("pointerdown", enable);
      window.removeEventListener("keydown", enable);
      tableAudio.dispose();
    };
  }, [tableAudio, view]);
  const send = (message) => {
      if (message.type === "bet") {
        clearTimeout(errorTimer.current);
        setError("");
      }
      transport.current?.send(message);
    },
    player = state?.players.find((p) => p.id === playerId),
    isAdmin = playerId && state?.adminId === playerId;
  function join(e) {
    e?.preventDefault();
    if (!joinName.trim()) {
      toast("Add your name to take a seat.");
      return;
    }
    const code = joinCode.trim().toUpperCase();
    if (!/^[A-Z2-9]{6}$/.test(code)) {
      toast("Enter the six-character room code.");
      return;
    }
    if (!session) {
      save(`crapstv:${code}`, { name: joinName.trim() });
      setSession({ kind: "online-join", code });
      setView("phone");
      return;
    }
    if (code !== session.code) {
      toast("Use the room code shown on your TV.");
      return;
    }
    save(`crapstv:${code}`, {
      ...(getSaved(`crapstv:${code}`) || {}),
      name: joinName.trim(),
    });
    send({
      type: "join",
      name: joinName.trim(),
      code,
      token: getSaved(`crapstv:${code}`)?.token,
    });
  }
  // Auto-submit the name entered on the online landing page once the peer connects.
  useEffect(() => {
    if (
      session?.kind === "online-join" &&
      status === "connected" &&
      state &&
      !playerId
    ) {
      const saved = getSaved(`crapstv:${session.code}`);
      if (saved?.name && !saved?.token) {
        send({ type: "join", code: session.code, name: saved.name });
      }
    }
  }, [status, state?.code]);
  const roomCode = state?.code || session?.code || "";
  const savedSeat =
    state?.pausedAt && player ? getSaved("crapstv:" + roomCode) : null;
  const reconnectSeat = (token) =>
    send({ type: "join", code: roomCode, token, reclaim: true });
  const kiosk =
    !route.controller &&
    (session?.kiosk === true ||
      new URLSearchParams(location.search).get("kiosk") === "1");
  // An existing local process keeps its loaded rules after the static UI updates.
  // Old hosts cannot gain corrected throws or physical props from a UI refresh.
  const hostWarning =
    state &&
    (state.physicsVersion || 0) < PHYSICS_VERSION &&
    dismissedHostCode !== roomCode
      ? "Older host: restart this server for current physics."
      : "";
  const visibleError = error || hostWarning;
  const musicAvailable = DESKTOP_DISPLAY && Array.isArray(jukebox?.queue);
  const musicEnabled = musicAvailable && jukebox.enabled;
  const sendMusic = (message) => {
    if (status !== "connected") return;
    setMusicSearch((current) =>
      message.type === "jukebox-search"
        ? { tracks: null, pending: true, error: "" }
        : { ...current, error: "" },
    );
    send(message);
  };
  const renderMusic = (inline) =>
    Jukebox &&
    musicEnabled && (
      <Suspense fallback={<p className="pg-empty">Loading music requests…</p>}>
        <Jukebox
          state={jukebox}
          search={musicSearch}
          isHost={isAdmin}
          connected={status === "connected"}
          bank={player?.bank ?? 0}
          playing={state?.status === "playing"}
          inline={inline}
          send={sendMusic}
          onClose={() => setJukeboxOpen(false)}
        />
      </Suspense>
    );
  const joinLink =
    androidHost && !session.joinOrigin
      ? ""
      : controllerURL(roomCode, session?.joinOrigin);
  const fallbackJoinLink =
    session?.lanOrigin && session.lanOrigin !== session.joinOrigin
      ? controllerURL(roomCode, session.lanOrigin)
      : null;
  const sceneAction = async (action) => {
    if (kiosk && (action === "settings" || action === "audio")) return;
    if (action === "settings") setSettingsOpen((v) => !v);
    if (action === "audio") setAudioOpen(true);
    if (action === "join") {
      if (androidHost) setAndroidPanel(session.joinOrigin ? "game" : "setup");
      else window.open(joinLink, "_blank", "noopener");
    }
    if (action === "host-network" && androidHost) setAndroidPanel("settings");
    if (action === "sound") setSound((value) => !value);
    if (action === "fullscreen") {
      if (document.fullscreenElement)
        await document.exitFullscreen?.().catch(() => {});
      else await document.documentElement.requestFullscreen?.().catch(() => {});
    }
    if (action === "reconnect") location.reload();
    if (action === "copy" || action === "copy-ip") {
      const link =
        action === "copy-ip" ? fallbackJoinLink || joinLink : joinLink;
      if (!link) return toast("Set up Wi-Fi in Settings first");
      try {
        await navigator.clipboard.writeText(link);
        toast("Join link copied");
      } catch {
        toast(link);
      }
    }
  };
  if (view === "tv")
    return (
      <main
        className="immersive-screen"
        data-testid="casino-scene"
        data-room-code={roomCode}
      >
        <Table3D
          state={state}
          code={roomCode}
          status={checking ? "connecting" : status}
          error={visibleError}
          sound={sound}
          handheld={androidHost}
          settingsOpen={kiosk ? false : settingsOpen}
          hideSettings={kiosk}
          joinURL={joinLink}
          fallbackJoinURL={fallbackJoinLink}
          tableAudio={tableAudio}
          onAction={sceneAction}
        />
        {DESKTOP_DISPLAY &&
          status === "connected" &&
          !state?.pausedAt &&
          jukebox?.tv && <JukeboxTVStatus music={jukebox.tv} />}
        {JukeboxVideo && status === "connected" && jukebox?.video && (
          <Suspense fallback={null}>
            <JukeboxVideo
              video={jukebox.video}
              onReport={(attempt, state) =>
                send({ type: "jukebox-video", attempt, status: state })
              }
            />
          </Suspense>
        )}
        {houseRulePrompt && (
          <HouseRuleChanceShowcase
            key={houseRulePrompt.id}
            prompt={houseRulePrompt}
            clockOffsetMs={state.clockOffsetMs}
          />
        )}
        {!houseRulePrompt && houseRuleShowcase && (
          <HouseRuleShowcase
            key={houseRuleShowcase.id}
            rule={houseRuleShowcase.rule}
            value={houseRuleShowcase.value}
            playerName={houseRuleShowcase.playerName}
          />
        )}
        <div className="scene-accessibility" aria-label="Table controls">
          {!kiosk && (
            <>
              <button onClick={() => sceneAction("settings")}>
                Table settings
              </button>
              <button onClick={() => sceneAction("audio")}>Table audio</button>
              {androidHost && (
                <button onClick={() => sceneAction("host-network")}>
                  Wi-Fi &amp; hosting
                </button>
              )}
            </>
          )}
          <p role="status">
            {status}. Room {roomCode}.{" "}
            {state?.pausedAt
              ? "Table saved"
              : state?.status === "ended"
                ? "Session closed"
                : state?.point
                  ? `Point ${state.point}`
                  : "Come out"}
            .
          </p>
          <button onClick={() => sceneAction("join")}>
            {androidHost ? "Pair players" : "Open phone controller"}
          </button>
          <button onClick={() => sceneAction("sound")}>
            {sound ? "Mute announcer" : "Enable announcer"}
          </button>
          <button onClick={() => sceneAction("fullscreen")}>
            Fullscreen table
          </button>
        </div>
        {androidHost && androidPanel && (
          <AndroidHostPanel
            page={androidPanel}
            onClose={() => setAndroidPanel(null)}
          />
        )}
        {audioOpen && !kiosk && (
          <TableAudioDialog
            settings={audioSettings}
            ready={audioReady}
            onChange={setAudioSettings}
            onPreview={() => tableAudio.preview()}
            onClose={() => setAudioOpen(false)}
          />
        )}
      </main>
    );
  return (
    <>
      {(!player || state?.status !== "playing" || player.left) && (
        <header className={player ? "header" : "header join-header"}>
          <Brand />
          <nav>
            <span className="desktop-only tagline">PHONE CONTROLLER</span>
            {session && (
              <button
                className={`connection ${status === "connected" ? "online" : ""}`}
                onClick={() => status !== "connected" && location.reload()}
              >
                <span />
                {status === "connected"
                  ? "Table connected"
                  : status === "connecting"
                    ? "Connecting…"
                    : "Reconnect"}
              </button>
            )}
            <button
              className="icon-button"
              aria-label={sound ? "Mute announcer" : "Enable announcer"}
              onClick={() => setSound((v) => !v)}
            >
              {sound ? <Volume2 size={19} /> : <VolumeX size={19} />}
            </button>
            {session && (
              <button
                className="icon-button"
                title={
                  view === "tv" ? "Play on this screen" : "Show TV display"
                }
                onClick={() => setView((v) => (v === "tv" ? "phone" : "tv"))}
              >
                {view === "tv" ? (
                  <Smartphone size={19} />
                ) : (
                  <Monitor size={19} />
                )}
              </button>
            )}
          </nav>
        </header>
      )}
      {visibleError && (
        <div className="toast" role="alert">
          <Info size={18} />
          {visibleError}
          <button
            aria-label="Dismiss"
            onClick={() => {
              setError("");
              setDismissedHostCode(roomCode);
            }}
          >
            <X size={16} />
          </button>
        </div>
      )}
      {checking || (session && !state) ? (
        <main className="connecting">
          <Dices size={32} />
          <h1>Connecting</h1>
          <p>{error || "Connecting to the table…"}</p>
        </main>
      ) : state?.pausedAt && !player?.left ? (
        <SavedTable
          player={player}
          isAdmin={isAdmin}
          token={savedSeat?.playerId === playerId ? savedSeat.token : null}
          connected={status === "connected"}
          onResume={() => send({ type: "resume-session" })}
          onReconnect={reconnectSeat}
        />
      ) : !player ? (
        <Join
          state={state}
          name={joinName}
          setName={setJoinName}
          code={joinCode}
          setCode={setJoinCode}
          join={join}
          connected={status === "connected"}
          reconnectSeat={reconnectSeat}
        />
      ) : state.status === "ended" || player.left ? (
        <main className="recap-page">
          <div className="eyebrow">
            {state.status === "ended"
              ? "THE TABLE IS CLOSED"
              : "YOU’VE CASHED OUT"}
          </div>
          <Recap player={player} state={state} />
          <button
            className="text-button"
            onClick={() => (location.href = document.baseURI)}
          >
            Back to the table <ArrowRight size={16} />
          </button>
          {isAdmin && state.status === "ended" && (
            <button
              className="button outline"
              onClick={() => send({ type: "reset" })}
            >
              Open a new table
            </button>
          )}
        </main>
      ) : (
        <Phone
          state={state}
          player={player}
          isAdmin={isAdmin}
          send={send}
          confirm={setConfirm}
          connected={status === "connected"}
          onDisplayAction={sceneAction}
          onTableAudio={() =>
            setAdminAudio(normalizeTableAudio(state.display?.audio))
          }
          serverError={error}
          fallbackJoinURL={fallbackJoinLink}
          onMusic={musicEnabled ? () => setJukeboxOpen(true) : undefined}
          musicArea={renderMusic(true)}
          musicSettings={musicAvailable ? jukebox : null}
          onMusicSettings={(settings) =>
            sendMusic({ type: "jukebox-control", action: "settings", settings })
          }
        />
      )}
      {jukeboxOpen &&
        musicEnabled &&
        player &&
        !player.left &&
        !state?.pausedAt &&
        state?.status === "lobby" &&
        renderMusic(false)}
      {adminAudio &&
        isAdmin &&
        player &&
        !player.left &&
        !state?.pausedAt &&
        state?.status !== "ended" && (
          <TableAudioDialog
            settings={adminAudio}
            onChange={setAdminAudio}
            canApply={status === "connected"}
            onApply={() => {
              send({ type: "display", settings: { audio: adminAudio } });
              setAdminAudio(null);
            }}
            onClose={() => setAdminAudio(null)}
          />
        )}
      {confirm && (
        <dialog
          ref={confirmDialog}
          className="modal confirmation-dialog"
          aria-labelledby="confirm-title"
          onCancel={() => setConfirm(null)}
        >
          <div className="eyebrow">LAST CALL</div>
          <h2 id="confirm-title">{SESSION_CONFIRM[confirm].title}</h2>
          <p>{SESSION_CONFIRM[confirm].detail}</p>
          <div className="button-row">
            <button className="button outline" onClick={() => setConfirm(null)}>
              Keep playing
            </button>
            <button
              className="button dark"
              onClick={() => {
                send({ type: confirm });
                setConfirm(null);
              }}
            >
              {SESSION_CONFIRM[confirm].button}
            </button>
          </div>
        </dialog>
      )}
    </>
  );
}
function Join({
  state,
  name,
  setName,
  code,
  setCode,
  join,
  connected,
  reconnectSeat,
}) {
  return (
    <main className="join-page">
      <section className="join-ticket" aria-labelledby="join-title">
        <div className="join-intro">
          <h1 id="join-title">Join table</h1>
          <span className="join-symbol" aria-hidden="true">
            <Dices size={22} />
          </span>
        </div>
        {state?.status === "ended" ? (
          <div className="notice">
            This table has closed. Ask the host to open a new one.
          </div>
        ) : (
          <form onSubmit={join}>
            <label>
              Your name
              <input
                autoComplete="nickname"
                value={name}
                maxLength={20}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Alex"
                required
              />
            </label>
            <div className="join-code-field">
              <label>
                Room code
                <input
                  className="code-input"
                  aria-describedby="join-code-help"
                  autoCapitalize="characters"
                  autoComplete="off"
                  spellCheck={false}
                  value={code}
                  maxLength={6}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  placeholder={state?.code || "ABCDEF"}
                  required
                />
              </label>
              <p id="join-code-help">Shown on the main screen.</p>
            </div>
            <button className="button dark join-submit" type="submit">
              Join <ArrowRight size={18} aria-hidden="true" />
            </button>
          </form>
        )}
        {state?.saveSessionAvailable &&
          state.status !== "ended" &&
          state.players.some((player) => !player.left && !player.bot) && (
            <ReconnectSeat connected={connected} onReconnect={reconnectSeat} />
          )}
      </section>
      <a className="text-button" href={document.baseURI}>
        <Monitor size={16} aria-hidden="true" /> Show main screen
      </a>
    </main>
  );
}
function Phone({
  state,
  player,
  isAdmin,
  send,
  confirm,
  connected,
  onDisplayAction,
  onTableAudio,
  onMusic,
  musicArea,
  musicSettings,
  onMusicSettings,
  serverError,
  fallbackJoinURL,
}) {
  const disabled = state.rolling || !connected;
  const adminProps = {
    state,
    player,
    send,
    connected,
    confirm,
    onDisplayAction,
    onTableAudio,
    musicSettings,
    onMusicSettings,
    fallbackJoinURL,
    serverError,
  };
  const settingsArea = (
    <details className="session-controls">
      <summary>
        {isAdmin ? "Host controls" : "Your session"}
        <ChevronDown size={15} />
      </summary>
      {isAdmin ? (
        <AdminPanel {...adminProps} />
      ) : (
        <button
          className="text-button"
          disabled={disabled}
          onClick={() => confirm("leave")}
        >
          <LogOut size={16} />
          Cash out & leave
        </button>
      )}
    </details>
  );

  if (state.status === "playing")
    return (
      <PhoneGame
        state={state}
        player={player}
        isAdmin={isAdmin}
        send={send}
        connected={connected}
        settingsArea={settingsArea}
        serverError={serverError}
        musicArea={musicArea}
        rollArea={
          <DiceThrow
            state={state}
            player={player}
            send={send}
            connected={connected}
          />
        }
      />
    );
  return (
    <main className="phone-page">
      {isAdmin ? (
        <AdminPanel {...adminProps} />
      ) : (
        <section className="waiting-card">
          <Dices size={35} />
          <h2>Your chips are waiting.</h2>
          <p>The host is setting up the table.</p>
          <div className="player-dots">
            {state.players
              .filter((p) => !p.left)
              .map((p) => (
                <span key={p.id} style={{ background: p.color }} title={p.name}>
                  {p.name[0]}
                </span>
              ))}
          </div>
        </section>
      )}
      {onMusic && (
        <button
          type="button"
          className="button outline jukebox-lobby"
          onClick={onMusic}
        >
          <Music2 size={18} /> Music requests
        </button>
      )}
      {!isAdmin && settingsArea}
    </main>
  );
}
createRoot(document.getElementById("root")).render(<App />);
