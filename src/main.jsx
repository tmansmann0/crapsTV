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
const TableScene = lazy(() => import("./Table3D.jsx"));
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
import { catalogue, describeBet, money, equity, net } from "./game.js";
import { PHYSICS_VERSION } from "./throw-motion.js";
import {
  detectLocal,
  localTransport,
  onlineTransport,
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
function useAnnouncer(state, enabled) {
  const manifest = useRef(null),
    last = useRef(null),
    lastLog = useRef(null),
    queue = useRef([]),
    playing = useRef(false),
    audio = useRef(null),
    latest = useRef(enabled);
  latest.current = enabled;
  useEffect(() => {
    fetch(`${base}audio/manifest.json`)
      .then((r) => r.json())
      .then((m) => (manifest.current = m))
      .catch(() => {});
    return () => {
      audio.current?.pause();
    };
  }, []);
  function play() {
    if (!latest.current || playing.current || !queue.current.length) return;
    const key = queue.current.shift(),
      entry = manifest.current?.[key];
    if (!entry) {
      play();
      return;
    }
    const a = new Audio(`${base}audio/${entry.file}`);
    audio.current = a;
    playing.current = true;
    a.onended = a.onerror = () => {
      playing.current = false;
      play();
    };
    a.play().catch(() => {
      playing.current = false;
      queue.current = [];
    });
  }
  useEffect(() => {
    if (!enabled) {
      audio.current?.pause();
      playing.current = false;
      queue.current = [];
      return;
    }
    queue.current.push("welcome");
    play();
  }, [enabled]);
  useEffect(() => {
    if (!state) return;
    const signature = `${state.status}:${state.rolling ? "rolling" : state.lastRoll?.id || ""}`,
      previous = last.current;
    last.current = signature;
    const newest = state.log[0],
      priorLog = lastLog.current;
    lastLog.current = newest?.id;
    if (!enabled || previous === null) return;
    if (newest?.id !== priorLog) {
      const key = {
        "player-joined": "player-joined",
        leave: "player-left",
        reup: "re-up",
        "teach-mode": "teach-mode",
      }[newest?.type];
      if (key) queue.current.push(key);
    }
    if (signature !== previous) {
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
  }, [state, enabled]);
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
    [joinName, setJoinName] = useState(""),
    [joinCode, setJoinCode] = useState(initialCode),
    [confirm, setConfirm] = useState(null);
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
        });
        setJoinCode(local.code);
      } else if (route.controller && initialCode) {
        setSession({ kind: "online-join", code: initialCode });
      } else if (!route.controller) {
        setSession({ kind: "online-host", code: newCode() });
      }
      setChecking(false);
    });
    return () => {
      mounted = false;
      clearTimeout(errorTimer.current);
    };
  }, []);
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
        setState({
          ...m.state,
          snapshotAt: m.sentAt || Date.now(),
          clockOffsetMs:
            clockOffset ??
            (typeof m.sentAt === "number" ? m.sentAt - Date.now() : 0),
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
      } else if (m.type === "error") toast(m.message);
      else if (m.type === "reset") {
        setPlayerId(null);
        save(key, null);
      }
    };
    const onStatus = (value) => {
      setStatus(value);
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
          );
    return () => {
      clockTimers.forEach(clearTimeout);
      transport.current?.close();
      transport.current = null;
    };
  }, [session?.kind, session?.code]);
  useEffect(() => {
    if (state?.display) setSound(state.display.sound);
  }, [state?.display?.revision]);
  useAnnouncer(state, sound && view === "tv");
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
  const joinLink = controllerURL(roomCode, session?.joinOrigin);
  const fallbackJoinLink =
    session?.lanOrigin && session.lanOrigin !== session.joinOrigin
      ? controllerURL(roomCode, session.lanOrigin)
      : null;
  const sceneAction = async (action) => {
    if (kiosk && action === "settings") return;
    if (action === "settings") setSettingsOpen((v) => !v);
    if (action === "join") window.open(joinLink, "_blank", "noopener");
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
          settingsOpen={kiosk ? false : settingsOpen}
          hideSettings={kiosk}
          joinURL={joinLink}
          fallbackJoinURL={fallbackJoinLink}
          onAction={sceneAction}
        />
        <div className="scene-accessibility" aria-label="Table controls">
          {!kiosk && (
            <button onClick={() => sceneAction("settings")}>
              Table settings
            </button>
          )}
          <p role="status">
            {status}. Room {roomCode}.{" "}
            {state?.status === "ended"
              ? "Session closed"
              : state?.point
                ? `Point ${state.point}`
                : "Come out"}
            .
          </p>
          <button onClick={() => sceneAction("join")}>
            Open phone controller
          </button>
          <button onClick={() => sceneAction("sound")}>
            {sound ? "Mute announcer" : "Enable announcer"}
          </button>
          <button onClick={() => sceneAction("fullscreen")}>
            Fullscreen table
          </button>
        </div>
      </main>
    );
  return (
    <>
      {(!player || state?.status !== "playing" || player.left) && (
        <header className="header">
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
      ) : !player ? (
        <Join
          state={state}
          name={joinName}
          setName={setJoinName}
          code={joinCode}
          setCode={setJoinCode}
          join={join}
          setView={setView}
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
          serverError={error}
          fallbackJoinURL={fallbackJoinLink}
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
          <h2 id="confirm-title">
            {confirm === "end" ? "Close the table?" : "Cash out for the night?"}
          </h2>
          <p>
            {confirm === "end"
              ? "Everyone gets their remaining chips back and a personal recap. This ends the session for all players."
              : "Your open bets are returned to your stack. Your recap is ready to save when you leave."}
          </p>
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
              {confirm === "end" ? "Close for everyone" : "Cash out"}
            </button>
          </div>
        </dialog>
      )}
    </>
  );
}
function Join({ state, name, setName, code, setCode, join }) {
  return (
    <main className="join-page">
      <div className="join-art">
        <Dices size={50} />
        <span>CONTROLLER</span>
      </div>
      <h1>Join table</h1>
      <p>Enter the code shown on the main screen.</p>
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
              placeholder="What should we call you?"
              required
            />
          </label>
          <label>
            Room code
            <input
              className="code-input"
              value={code}
              maxLength={6}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder={state?.code || "ABCDEF"}
              required
            />
          </label>
          <button className="button dark jumbo" type="submit">
            Join <ArrowRight size={18} />
          </button>
        </form>
      )}
      <button
        className="text-button"
        onClick={() => (location.href = document.baseURI)}
      >
        Show main screen <Monitor size={16} />
      </button>
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
        rollArea={
          <DiceThrow
            state={state}
            player={player}
            isAdmin={isAdmin}
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
      {!isAdmin && settingsArea}
    </main>
  );
}
createRoot(document.getElementById("root")).render(<App />);
