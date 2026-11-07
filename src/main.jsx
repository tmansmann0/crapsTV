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
import { catalogue, describeBet, money, equity, net } from "./game.js";
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
  const send = (message) => transport.current?.send(message),
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
  const joinLink = controllerURL(roomCode, session?.joinOrigin);
  const fallbackJoinLink =
    session?.lanOrigin && session.lanOrigin !== session.joinOrigin
      ? controllerURL(roomCode, session.lanOrigin)
      : null;
  const sceneAction = async (action) => {
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
          error={error}
          sound={sound}
          settingsOpen={settingsOpen}
          joinURL={joinLink}
          fallbackJoinURL={fallbackJoinLink}
          onAction={sceneAction}
        />
        <div className="scene-accessibility" aria-label="Table controls">
          <button onClick={() => sceneAction("settings")}>
            Table settings
          </button>
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
      {error && (
        <div className="toast" role="alert">
          <Info size={18} />
          {error}
          <button aria-label="Dismiss" onClick={() => setError("")}>
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
  const settingsArea = (
    <details className="session-controls">
      <summary>
        {isAdmin ? "Host controls" : "Your session"}
        <ChevronDown size={15} />
      </summary>
      {isAdmin && (
        <>
          <div className="admin-display-settings">
            <h3>TV settings</h3>
            <label className="toggle-label">
              <span>TV announcer</span>
              <input
                aria-label="TV announcer"
                type="checkbox"
                checked={state.display?.sound || false}
                onChange={(e) =>
                  send({
                    type: "display",
                    settings: { sound: e.target.checked },
                  })
                }
              />
            </label>
            <label>
              TV camera
              <select
                aria-label="TV camera"
                value={state.display?.camera || "auto"}
                onChange={(e) =>
                  send({
                    type: "display",
                    settings: { camera: e.target.value },
                  })
                }
              >
                <option value="auto">Auto</option>
                <option value="table">Table</option>
                <option value="room">Room</option>
              </select>
            </label>
            <div
              className="admin-graphics-settings"
              style={{
                borderTop: "1px solid var(--line)",
                paddingTop: 14,
                marginTop: 16,
              }}
            >
              <h3>Graphics</h3>
              <p style={{ fontSize: 12, lineHeight: 1.5, marginBottom: 15 }}>
                Auto checks the TV and chooses settings for that display. Manual
                choices override its recommendation.
              </p>
              {Object.entries({
                fps: "Frame rate",
                antialias: "Antialiasing",
                resolution: "Resolution",
                modelDetail: "Model detail",
                textures: "Textures",
              }).map(([key, label]) => (
                <label key={key}>
                  {label}
                  <select
                    aria-label={`TV graphics ${label.toLowerCase()}`}
                    value={state.display?.graphics?.[key] ?? "auto"}
                    disabled={!connected}
                    onChange={(event) =>
                      send({
                        type: "display",
                        settings: {
                          graphics: {
                            [key]:
                              key === "fps" && event.target.value !== "auto"
                                ? Number(event.target.value)
                                : event.target.value,
                          },
                        },
                      })
                    }
                  >
                    {GRAPHICS_OPTIONS[key].map((option) => (
                      <option key={String(option.value)} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
              <button
                type="button"
                className="button outline small"
                disabled={!connected}
                onClick={() =>
                  send({
                    type: "display",
                    settings: { graphics: { ...DEFAULT_GRAPHICS } },
                  })
                }
              >
                Use automatic graphics
              </button>
            </div>
            <div className="button-row">
              <button
                className="button outline small"
                onClick={() => onDisplayAction("copy")}
              >
                Copy invite
              </button>
              {fallbackJoinURL && (
                <button
                  className="button outline small"
                  onClick={() => onDisplayAction("copy-ip")}
                >
                  Copy IP invite
                </button>
              )}
              <button
                className="button outline small"
                onClick={() => onDisplayAction("join")}
              >
                Controller
              </button>
              <button
                className="button outline small"
                onClick={() => onDisplayAction("fullscreen")}
              >
                Fullscreen this device
              </button>
            </div>
          </div>
          <label className="toggle-label">
            <span>
              <BookOpen size={16} />
              Teach mode
            </span>
            <input
              type="checkbox"
              checked={state.config.teach}
              onChange={(e) => send({ type: "teach", value: e.target.checked })}
            />
          </label>
          {state.players.filter((p) => !p.left && p.id !== player.id).length >
            0 && (
            <label>
              Pass host controls
              <select
                defaultValue=""
                onChange={(e) => {
                  if (e.target.value)
                    send({ type: "transfer", playerId: e.target.value });
                  e.target.value = "";
                }}
              >
                <option value="" disabled>
                  Choose a player
                </option>
                {state.players
                  .filter((p) => !p.left && p.id !== player.id)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                      {!p.connected ? " (offline)" : ""}
                    </option>
                  ))}
              </select>
            </label>
          )}
          {state.status === "playing" && (
            <button
              className="button outline"
              disabled={disabled}
              onClick={() => confirm("end")}
            >
              Close table for everyone
            </button>
          )}
        </>
      )}
      <button
        className="text-button"
        disabled={disabled}
        onClick={() => confirm("leave")}
      >
        <LogOut size={16} /> Cash out & leave
      </button>
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
        <Setup state={state} send={send} />
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
      {settingsArea}
    </main>
  );
}
function Setup({ state, send }) {
  const [bank, setBank] = useState(state.config.startingBank / 100),
    [min, setMin] = useState(state.config.minBet / 100),
    [mode, setMode] = useState(state.config.mode),
    [teach, setTeach] = useState(state.config.teach);
  function start(e) {
    e.preventDefault();
    send({
      type: "start",
      config: {
        startingBank: Math.round(Number(bank) * 100),
        minBet: Math.round(Number(min) * 100),
        mode,
        teach,
      },
    });
  }
  return (
    <form className="setup" onSubmit={start}>
      <div className="eyebrow">
        <Crown size={15} /> HOST SETTINGS
      </div>
      <h2>Table setup</h2>
      <div className="mode-picker">
        {[
          ["craps", "Classic craps", "7 or 11 wins on the come-out."],
          [
            "crapless",
            "Crapless craps",
            "Every number except 7 can become the point.",
          ],
        ].map(([v, title, desc]) => (
          <button
            type="button"
            key={v}
            className={mode === v ? "selected" : ""}
            onClick={() => setMode(v)}
          >
            <span>
              {title}
              {mode === v && <Check size={16} />}
            </span>
            <small>{desc}</small>
          </button>
        ))}
      </div>
      <div className="form-row">
        <label>
          Starting chips ($)
          <input
            type="number"
            min="10"
            max="1000000"
            step="1"
            value={bank}
            onChange={(e) => setBank(e.target.value)}
            required
          />
        </label>
        <label>
          Table minimum ($)
          <input
            type="number"
            min="1"
            max={bank}
            step="1"
            value={min}
            onChange={(e) => setMin(e.target.value)}
            required
          />
        </label>
      </div>
      <label className="toggle-label">
        <span>
          <BookOpen size={18} />
          <div>
            Teach mode<small>Payouts, probabilities, and useful context.</small>
          </div>
        </span>
        <input
          type="checkbox"
          checked={teach}
          onChange={(e) => setTeach(e.target.checked)}
        />
      </label>
      <button type="submit" className="button dark jumbo">
        Open the table <ArrowRight size={18} />
      </button>
      <p className="fine-print">Teach mode can be changed during play.</p>
    </form>
  );
}
createRoot(document.getElementById("root")).render(<App />);
