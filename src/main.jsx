import React, { lazy, Suspense, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Check,
  ChevronDown,
  Copy,
  Crown,
  Dices,
  Expand,
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
  Wifi,
  X,
} from "lucide-react";
import QRCode from "qrcode";
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
import { catalogue, money, equity, net } from "./game.js";
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
function Brand({ large = false }) {
  return (
    <a
      className={`brand ${large ? "large" : ""}`}
      href={location.pathname}
      aria-label="crapsTV home"
    >
      <Dices />
      <span>
        craps<span>TV</span>
        <i>✦</i>
      </span>
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
  const query = new URLSearchParams(location.search),
    initialCode = query.get("join") || "";
  const [session, setSession] = useState(null),
    [checking, setChecking] = useState(true),
    [state, setState] = useState(null),
    [view, setView] = useState(initialCode ? "phone" : "tv"),
    [playerId, setPlayerId] = useState(null),
    [status, setStatus] = useState("connecting"),
    [error, setError] = useState(""),
    [sound, setSound] = useState(false),
    [joinName, setJoinName] = useState(""),
    [joinCode, setJoinCode] = useState(initialCode),
    [confirm, setConfirm] = useState(null);
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
        setSession({ kind: "local", code: local.code });
        setJoinCode(local.code);
      } else if (initialCode) {
        setSession({ kind: "online-join", code: initialCode.toUpperCase() });
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
    const onMessage = (m) => {
      if (m.type === "state") setState(m.state);
      else if (m.type === "welcome") {
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
      transport.current?.close();
      transport.current = null;
    };
  }, [session?.kind, session?.code]);
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
  const onlineHost = () => {
    const code = newCode();
    setSession({ kind: "online-host", code });
    setJoinCode(code);
    setView("tv");
  };
  const roomCode = state?.code || session?.code;
  return (
    <>
      <header className="header">
        <Brand />
        <nav>
          <span className="desktop-only tagline">
            A LITTLE VEGAS. A LOT OF YOU.
          </span>
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
              title={view === "tv" ? "Play on this screen" : "Show TV display"}
              onClick={() => setView((v) => (v === "tv" ? "phone" : "tv"))}
            >
              {view === "tv" ? <Smartphone size={19} /> : <Monitor size={19} />}
            </button>
          )}
        </nav>
      </header>
      {error && (
        <div className="toast" role="alert">
          <Info size={18} />
          {error}
          <button aria-label="Dismiss" onClick={() => setError("")}>
            <X size={16} />
          </button>
        </div>
      )}
      {!session && checking ? (
        <main className="connecting">
          <Dices size={42} />
          <h1>Finding your table.</h1>
        </main>
      ) : !session ? (
        <Landing
          checking={checking}
          onlineHost={onlineHost}
          name={joinName}
          setName={setJoinName}
          code={joinCode}
          setCode={setJoinCode}
          join={join}
        />
      ) : !state ? (
        <main className="connecting">
          <Dices size={42} />
          <h1>Pulling up your table.</h1>
          <p>
            Room {roomCode} ·{" "}
            {status === "disconnected"
              ? "The host could not be reached."
              : "Making room for a good night."}
          </p>
          <button
            className="button dark"
            onClick={() => (location.href = location.pathname)}
          >
            Back to lobby
          </button>
        </main>
      ) : view === "tv" ? (
        <TV state={state} session={session} setView={setView} />
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
          <button className="text-button" onClick={() => setView("tv")}>
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
        />
      )}
      {confirm && (
        <div className="modal-backdrop">
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="confirm-title"
          >
            <div className="eyebrow">LAST CALL</div>
            <h2 id="confirm-title">
              {confirm === "end"
                ? "Close the table?"
                : "Cash out for the night?"}
            </h2>
            <p>
              {confirm === "end"
                ? "Everyone gets their remaining chips back and a personal recap. This ends the session for all players."
                : "Your open bets are returned to your stack. Your recap is ready to save when you leave."}
            </p>
            <div className="button-row">
              <button
                className="button outline"
                onClick={() => setConfirm(null)}
              >
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
          </section>
        </div>
      )}
      <footer>
        <span>
          crapsTV <span>✦</span> MADE FOR A FULL HOUSE.
        </span>
        <span>Play chips. No real-money wagering.</span>
      </footer>
    </>
  );
}
function Landing({ checking, onlineHost, name, setName, code, setCode, join }) {
  return (
    <main className="landing">
      <section className="landing-copy">
        <div className="eyebrow">
          <span className="tiny-star">✦</span> THE LIVING ROOM CASINO
        </div>
        <h1>
          Good company.
          <br />
          <em>
            Questionable
            <br />
            odds.
          </em>
        </h1>
        <p>
          Your TV is the table. Your phone holds the chips.
          <br />
          Bring your friends. We’ll bring a little Vegas.
        </p>
        <button
          className="button dark jumbo"
          disabled={checking}
          onClick={onlineHost}
        >
          <Monitor size={19} />
          {checking ? "Finding your table…" : "Host an online table"}
          <ArrowUpRight size={20} />
        </button>
        <div className="fine-print">
          <Check size={14} /> No download for your friends <span>·</span> Up to
          12 players
        </div>
        <form className="landing-join" onSubmit={join}>
          <div className="eyebrow">ALREADY GOT A SEAT?</div>
          <div>
            <input
              aria-label="Your name"
              placeholder="Your name"
              value={name}
              maxLength={20}
              onChange={(e) => setName(e.target.value)}
            />
            <input
              aria-label="Room code"
              className="code-input"
              placeholder="CODE"
              value={code}
              maxLength={6}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
            />
            <button aria-label="Join table" type="submit">
              <ArrowRight />
            </button>
          </div>
        </form>
      </section>
      <section className="landing-visual">
        <div className="visual-top">
          <span>
            <i /> THE BEST TABLE IN THE HOUSE
          </span>
          <span>OPEN ALL NIGHT</span>
        </div>
        <Table3D preview />
        <div className="visual-caption">
          <span className="script">Your place. Your people.</span>
          <span>EST. TONIGHT ↗</span>
        </div>
        <img className="hero-chip" src={`${base}assets/ui-chip.png`} alt="" />
      </section>
      <div className="feature-strip">
        <div>
          <Dices />
          <h3>Two ways to roll.</h3>
          <p>Classic craps or crapless. Same friends, different odds.</p>
        </div>
        <div>
          <BookOpen />
          <h3>First timer? Perfect.</h3>
          <p>Teach mode puts payouts and probabilities in your pocket.</p>
        </div>
        <div>
          <Sparkles />
          <h3>Make a night of it.</h3>
          <p>Re-up, rally, and save your own end-of-night recap.</p>
        </div>
      </div>
      <div className="online-note">
        <Wifi size={15} />
        <span>
          Online rooms use a free peer connection. Keep the TV tab open. For
          local play, run the included server and join on the same Wi-Fi.
        </span>
      </div>
    </main>
  );
}
function Join({ state, name, setName, code, setCode, join, setView }) {
  return (
    <main className="join-page">
      <div className="join-art">
        <Dices size={50} />
        <span>ONE MORE AT THE TABLE.</span>
      </div>
      <h1>Take a seat.</h1>
      <p>
        The first player to join runs the table.
        <br />
        Everyone else brings the luck.
      </p>
      {state.status === "ended" ? (
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
              placeholder={state.code}
              required
            />
          </label>
          <button className="button dark jumbo" type="submit">
            I’m feeling lucky <ArrowRight size={18} />
          </button>
        </form>
      )}
      <button className="text-button" onClick={() => setView("tv")}>
        Just watching? Show the TV <Monitor size={16} />
      </button>
    </main>
  );
}
function JoinCard({ state, session, setView }) {
  const [qr, setQr] = useState(""),
    [copied, setCopied] = useState(false);
  const url = new URL(location.pathname, location.origin);
  url.searchParams.set("join", state.code);
  const isLocalhost = ["localhost", "127.0.0.1", "[::1]"].includes(
      location.hostname,
    ),
    usable = !(session.kind === "local" && isLocalhost);
  useEffect(() => {
    QRCode.toDataURL(url.href, {
      margin: 1,
      width: 160,
      color: { dark: "#411c24", light: "#f4eee3" },
    }).then(setQr);
  }, [url.href]);
  return (
    <section className="join-card">
      <div className="eyebrow">YOUR PHONE IS YOUR CONTROLLER</div>
      <div className="join-card-body">
        {usable && qr ? (
          <img className="qr" src={qr} alt="Scan to join this room" />
        ) : (
          <div className="qr-placeholder">
            <Wifi size={32} />
          </div>
        )}
        <div>
          <p>Pull up a chair.</p>
          <h2>{state.code}</h2>
          <span>
            {session.kind === "local"
              ? "SAME WI-FI, SAME GOOD NIGHT."
              : "SIX LETTERS. ENDLESS POSSIBILITIES."}
          </span>
        </div>
      </div>
      <p className="join-help">
        {usable
          ? "Scan the code or open this link on your phone."
          : "Open the LAN address printed in your terminal on this TV to get a phone-ready QR code."}
      </p>
      <div className="button-row">
        <button
          className="button outline small"
          disabled={!usable}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(url.href);
              setCopied(true);
              setTimeout(() => setCopied(false), 1800);
            } catch {
              window.prompt("Copy this join link", url.href);
            }
          }}
        >
          {copied ? <Check size={14} /> : <Copy size={14} />}{" "}
          {copied ? "Copied" : "Copy invite"}
        </button>
        <button className="button small dark" onClick={() => setView("phone")}>
          Join here <ArrowRight size={14} />
        </button>
      </div>
    </section>
  );
}
function TV({ state, session, setView }) {
  const players = state.players.filter((p) => !p.left),
    shooter = players.find((p) => p.id === state.shooterId),
    ended = state.status === "ended";
  return (
    <main className="tv-page">
      <div className="tv-heading">
        <div>
          <div className="eyebrow">
            {ended
              ? "ONE FOR THE MEMORY BOOKS"
              : state.status === "lobby"
                ? "A GOOD NIGHT STARTS HERE"
                : "THE LIVING ROOM CASINO"}
          </div>
          <h1>
            {ended ? (
              "What a night."
            ) : state.status === "lobby" ? (
              <>
                The table is <em>yours.</em>
              </>
            ) : (
              <>
                Let the good times <em>roll.</em>
              </>
            )}
          </h1>
        </div>
        <div className="table-tags">
          <span>
            <Dices size={15} />
            {state.config.mode === "crapless"
              ? "Crapless craps"
              : "Classic craps"}
          </span>
          <span>{money(state.config.minBet)} minimum</span>
          {state.config.teach && (
            <span>
              <BookOpen size={15} />
              Teach mode
            </span>
          )}
        </div>
      </div>
      {ended ? (
        <>
          <div className="end-summary">
            <Sparkles size={26} />
            <h2>
              {state.rolls.length} rolls. {state.players.length} legends.
            </h2>
            <p>
              Open your phone for your personal recap. Same table next time?
            </p>
          </div>
          <div className="recap-grid">
            {state.players.map((p) => (
              <Recap key={p.id} player={p} state={state} compact />
            ))}
          </div>
        </>
      ) : (
        <div className="tv-grid">
          <section className="table-stage">
            <div className="stage-top">
              <span>
                <i className={state.rolling ? "live rolling" : "live"} />
                {state.rolling
                  ? "DICE ARE OUT"
                  : state.status === "lobby"
                    ? "WAITING FOR YOUR PEOPLE"
                    : "BETS ARE OPEN"}
              </span>
              <button
                aria-label="Fullscreen table"
                onClick={() => {
                  if (document.fullscreenElement)
                    document.exitFullscreen?.().catch(() => {});
                  else
                    document.documentElement
                      .requestFullscreen?.()
                      .catch(() => {});
                }}
              >
                <Expand size={17} />
              </button>
            </div>
            <Table3D state={state} />
            <img
              className="stage-logo"
              src={`${base}assets/brand-logo.png`}
              alt="crapsTV"
            />
            <div className="table-overlay">
              <div className={`point-puck ${state.point ? "on" : ""}`}>
                <span>{state.point ? "POINT" : "COME OUT"}</span>
                <b>{state.point || "OFF"}</b>
              </div>
              {state.status === "playing" && (
                <div className="result-banner" aria-live="polite">
                  {state.rolling ? (
                    <>
                      <Dices className="dice-spin" />
                      <h2>A little suspense…</h2>
                    </>
                  ) : (
                    <>
                      <span className="roll-total">
                        {state.lastRoll?.total || "✦"}
                      </span>
                      <div>
                        <h2>
                          {state.lastRoll?.message || "It’s your lucky night."}
                        </h2>
                        <p>
                          {shooter?.name || "Next player"} has the dice · roll{" "}
                          {state.rolls.length + 1}
                        </p>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
            <div className="stage-bottom">
              <span className="script">Your place. Your people.</span>
              <div className="recent-rolls">
                {state.rolls.length ? (
                  state.rolls.slice(-10).map((r) => (
                    <span
                      key={r.id}
                      className={r.total === 7 ? "seven" : ""}
                      title={r.message}
                    >
                      {r.total}
                    </span>
                  ))
                ) : (
                  <span className="empty-rolls">
                    THE FIRST ROLL IS A PHONE AWAY.
                  </span>
                )}
              </div>
            </div>
          </section>
          <aside className="tv-sidebar">
            <JoinCard state={state} session={session} setView={setView} />
            <section className="rail">
              <div className="section-label">
                AT THE RAIL <span>{players.length}/12</span>
              </div>
              {players.length ? (
                players
                  .slice()
                  .sort((a, b) => net(b) - net(a))
                  .map((p) => (
                    <div className="rail-player" key={p.id}>
                      <div className="avatar" style={{ "--player": p.color }}>
                        {p.name[0].toUpperCase()}
                      </div>
                      <div className="player-name">
                        <b>
                          {p.name}{" "}
                          {p.id === state.adminId && <Crown size={12} />}
                        </b>
                        <span>
                          {p.id === state.shooterId
                            ? "✦ Has the dice"
                            : !p.connected
                              ? "Reconnecting…"
                              : money(
                                  p.bets.reduce((n, b) => n + b.amount, 0),
                                ) + " on the felt"}
                        </span>
                      </div>
                      <div className="player-bank">
                        <b>{money(equity(p))}</b>
                        <span className={net(p) >= 0 ? "positive" : "negative"}>
                          {net(p) >= 0 ? "+" : "−"}
                          {money(Math.abs(net(p)))}
                        </span>
                      </div>
                    </div>
                  ))
              ) : (
                <div className="empty-rail">
                  <span>✦</span>
                  <p>
                    The seats are empty.
                    <br />
                    The possibilities aren’t.
                  </p>
                </div>
              )}
            </section>
            {state.status === "lobby" ? (
              <div className="host-note">
                <Crown size={17} />
                <p>
                  {players.length
                    ? `${players[0].name} is setting the house rules on their phone.`
                    : "First to join sets the house rules. Starting chips, game mode, and how much help you want."}
                </p>
              </div>
            ) : (
              <section className="table-feed">
                <div className="section-label">TABLE TALK</div>
                {state.log.slice(0, 3).map((l) => (
                  <p key={l.id}>
                    <span>✦</span>
                    {l.text}
                  </p>
                ))}
              </section>
            )}
          </aside>
        </div>
      )}
      <div className="tv-bottom-note">
        <span>
          <Smartphone size={16} /> Bets and host controls live on your phone.
        </span>
        <span>NO CASH. NO PRESSURE. JUST ONE MORE ROLL.</span>
      </div>
    </main>
  );
}
function Phone({ state, player, isAdmin, send, confirm, connected }) {
  const [tab, setTab] = useState("table"),
    [chip, setChip] = useState(500),
    [group, setGroup] = useState("The essentials");
  const items = catalogue(state, player),
    isShooter = state.shooterId === player.id,
    disabled = state.rolling || !connected;
  const canReup = equity(player) < state.config.minBet && !player.bets.length;
  return (
    <main className="phone-page">
      <div className="phone-head">
        <div>
          <div className="eyebrow">
            ROOM {state.code} {isAdmin && <span>· HOST</span>}
          </div>
          <h1>
            Hey, {player.name}
            <span>✦</span>
          </h1>
        </div>
        <div className="avatar" style={{ "--player": player.color }}>
          {player.name[0].toUpperCase()}
        </div>
      </div>
      <section className="wallet">
        <div>
          <span>YOUR STACK</span>
          <strong>{money(player.bank)}</strong>
          <small>
            {money(player.bets.reduce((n, b) => n + b.amount, 0))} on the felt
          </small>
        </div>
        <div>
          <span>TONIGHT</span>
          <b className={net(player) >= 0 ? "positive" : "negative"}>
            {net(player) >= 0 ? "+" : "−"}
            {money(Math.abs(net(player)))}
          </b>
          <small>{player.stats.reups} re-ups</small>
        </div>
      </section>
      {state.status === "lobby" ? (
        <>
          {isAdmin ? (
            <Setup state={state} send={send} />
          ) : (
            <section className="waiting-card">
              <Dices size={35} />
              <h2>Your chips are waiting.</h2>
              <p>The host is setting up the table. You’re in.</p>
              <div className="player-dots">
                {state.players
                  .filter((p) => !p.left)
                  .map((p) => (
                    <span
                      key={p.id}
                      style={{ background: p.color }}
                      title={p.name}
                    >
                      {p.name[0]}
                    </span>
                  ))}
              </div>
            </section>
          )}
        </>
      ) : (
        <>
          <div className="phone-game-status">
            <span>
              {state.rolling
                ? "DICE ARE OUT"
                : state.point
                  ? `POINT IS ${state.point}`
                  : "COME-OUT ROLL"}
            </span>
            <span>
              {state.lastRoll
                ? `Last roll: ${state.lastRoll.dice.join(" + ")} = ${state.lastRoll.total}`
                : "Time to start something."}
            </span>
          </div>
          {state.lastRoll && (
            <div className="phone-result" aria-live="polite">
              {state.lastRoll.message}
              {state.lastRoll.events.find((e) => e.playerId === player.id) && (
                <b>
                  {state.lastRoll.events.find((e) => e.playerId === player.id)
                    .delta >= 0
                    ? "+"
                    : "−"}
                  {money(
                    Math.abs(
                      state.lastRoll.events.find(
                        (e) => e.playerId === player.id,
                      ).delta,
                    ),
                  )}
                </b>
              )}
            </div>
          )}
          <div className="phone-tabs" role="tablist">
            {[
              ["table", "Place bets"],
              ["bets", `My bets (${player.bets.length})`],
              ["learn", "Table guide"],
            ].map(([id, label]) => (
              <button
                key={id}
                role="tab"
                aria-selected={tab === id}
                className={tab === id ? "active" : ""}
                onClick={() => setTab(id)}
              >
                {label}
              </button>
            ))}
          </div>
          {tab === "table" && (
            <>
              <div className="chip-select">
                <span>CHOOSE A CHIP</span>
                <div>
                  {[500, 2500, 10000, 50000].map((n) => (
                    <button
                      key={n}
                      onClick={() => setChip(n)}
                      className={chip === n ? "selected" : ""}
                    >
                      {money(n)}
                    </button>
                  ))}
                </div>
              </div>
              <div className="group-tabs">
                {[...new Set(items.map((b) => b.group))].map((g) => (
                  <button
                    className={group === g ? "active" : ""}
                    key={g}
                    onClick={() => setGroup(g)}
                  >
                    {g}
                  </button>
                ))}
              </div>
              <div className="bet-list">
                {items
                  .filter((b) => b.group === group)
                  .map((b) => (
                    <BetCard
                      key={b.id}
                      bet={b}
                      chip={chip}
                      teach={state.config.teach}
                      disabled={
                        disabled ||
                        player.bank <
                          Math.max(
                            b.minimum,
                            Math.ceil(chip / b.quantum) * b.quantum,
                          )
                      }
                      send={send}
                    />
                  ))}
              </div>
              {group === "True odds" &&
                !items.some((b) => b.group === group) && (
                  <p>Place a line bet and establish its point to add odds.</p>
                )}
            </>
          )}
          {tab === "bets" && (
            <div className="active-bets">
              {player.bets.length ? (
                player.bets.map((b) => {
                  const meta = items.find(
                      (i) => i.id === b.type || i.id === `odds:${b.parent}`,
                    ),
                    locked = b.point && ["pass", "come"].includes(b.type),
                    off =
                      !state.point &&
                      (b.type.startsWith("place") ||
                        b.type.startsWith("hard") ||
                        (b.type === "odds" &&
                          player.bets.find((p) => p.id === b.parent)?.type ===
                            "come"));
                  return (
                    <article key={b.id}>
                      <div>
                        <h3>
                          {meta?.name || b.type}
                          {b.point && b.type !== "odds" ? ` · ${b.point}` : ""}
                        </h3>
                        <b>{money(b.amount)}</b>
                        <span>
                          {locked
                            ? "Locked until its point resolves"
                            : off
                              ? "Off on this come-out roll"
                              : "Working on the next roll"}
                        </span>
                        {state.config.teach && meta && (
                          <p>
                            {meta.payout} profit ·{" "}
                            {(meta.prob * 100).toFixed(1)}% win chance
                          </p>
                        )}
                      </div>
                      <button
                        aria-label={`Take down ${meta?.name || b.type}`}
                        disabled={disabled || locked}
                        onClick={() => send({ type: "remove", betId: b.id })}
                      >
                        <Minus size={17} />
                      </button>
                    </article>
                  );
                })
              ) : (
                <section className="empty-bets">
                  <Dices size={36} />
                  <h3>A clean felt.</h3>
                  <p>Pick your chip and place a bet to get in on it.</p>
                  <button
                    className="text-button"
                    onClick={() => setTab("table")}
                  >
                    Find your bet <ArrowRight size={16} />
                  </button>
                </section>
              )}
            </div>
          )}
          {tab === "learn" && <Guide state={state} items={items} />}
          {canReup && (
            <div className="reup-banner">
              <RefreshCw size={24} />
              <div>
                <h3>Down, but never out.</h3>
                <p>
                  Re-up to {money(state.config.startingBank)}. Your recap keeps
                  the full story.
                </p>
              </div>
              <button
                className="button dark small"
                disabled={disabled}
                onClick={() => send({ type: "reup" })}
              >
                Re-up
              </button>
            </div>
          )}
          <div className="roll-controls">
            {isShooter || isAdmin ? (
              <button
                className="button dark jumbo roll-button"
                disabled={disabled}
                onClick={() => send({ type: "roll" })}
              >
                <Dices size={22} />
                {state.rolling
                  ? "Dice are rolling…"
                  : isShooter
                    ? "Roll the dice"
                    : "Roll for the table"}
                <ArrowRight size={20} />
              </button>
            ) : (
              <p>
                <Dices size={19} />
                {state.players.find((p) => p.id === state.shooterId)?.name ||
                  "The host"}{" "}
                has the dice.
              </p>
            )}
            <span>
              {state.rolling
                ? "No more bets until the dice settle."
                : "Everyone’s bets lock when the dice roll."}
            </span>
          </div>
        </>
      )}
      <details className="session-controls">
        <summary>
          {isAdmin ? "Host controls" : "Your session"}
          <ChevronDown size={15} />
        </summary>
        {isAdmin && (
          <>
            <label className="toggle-label">
              <span>
                <BookOpen size={16} />
                Teach mode
              </span>
              <input
                type="checkbox"
                checked={state.config.teach}
                onChange={(e) =>
                  send({ type: "teach", value: e.target.checked })
                }
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
        <Crown size={15} /> YOU MAKE THE HOUSE RULES
      </div>
      <h2>Set the night in motion.</h2>
      <div className="mode-picker">
        {[
          [
            "craps",
            "Classic craps",
            "The original. Seven, eleven, and a little nerve.",
          ],
          [
            "crapless",
            "Crapless craps",
            "Every number but seven can become a point.",
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
      <p className="fine-print">
        You can toggle teaching anytime. Rules lock at the first roll.
      </p>
    </form>
  );
}
function BetCard({ bet, chip, teach, disabled, send }) {
  const amount = Math.max(
      bet.minimum,
      Math.ceil(chip / bet.quantum) * bet.quantum,
    ),
    allowed = bet.available && !disabled;
  return (
    <article className={`bet-card ${!bet.available ? "unavailable" : ""}`}>
      <div className="bet-title">
        <h3>{bet.name}</h3>
        <span>{bet.payout}</span>
      </div>
      <p>{bet.description}</p>
      {teach && (
        <div className="teach-data">
          <span>
            <b>{(bet.prob * 100).toFixed(1)}%</b> win chance
          </span>
          <span>
            <b>{bet.edge.toFixed(2)}%</b> house edge
          </span>
        </div>
      )}
      <button
        disabled={!allowed}
        onClick={() => send({ type: "bet", betId: bet.id, amount })}
      >
        {bet.available ? (
          <>
            <Plus size={15} /> {money(amount)}
            <span>{amount !== chip ? "proper bet size" : "Place bet"}</span>
          </>
        ) : bet.id === "pass" || bet.id === "dont" ? (
          "Available on the come-out"
        ) : (
          "Available once a point is set"
        )}
      </button>
    </article>
  );
}
function Guide({ state, items }) {
  return (
    <section className="guide">
      <div className="eyebrow">A LITTLE KNOW-HOW GOES A LONG WAY</div>
      <h2>Meet the table.</h2>
      <p>
        {state.config.mode === "crapless"
          ? "In crapless, a come-out 7 wins. Every other number becomes the point. There is no don’t side."
          : "On the come-out, 7 or 11 wins a pass bet. 2, 3, or 12 loses. Any other number sets the point."}{" "}
        Once the point is set, pass bets want it to repeat before a 7.
      </p>
      <div className="guide-note">
        <Info size={18} />
        <p>
          Payouts show <b>profit</b>, with your original stake also returned
          when a bet closes. Persistent place, big-number and hardway bets stay
          on the felt after a win.
        </p>
      </div>
      <p>
        Place bets, hardways and come odds are off on come-out rolls. Traveled
        come bets still work. Don’t come odds remain working. Odds are capped at
        5× the original line bet. Proper bet sizes keep payouts exact to the
        dollar.
      </p>
      <h3>The whole menu</h3>
      <p className="muted">
        Win chances describe a full bet through resolution, not necessarily the
        next roll. Place and hardway odds exclude off rolls. A fresh don’t bet
        can also push on 12. Line odds shown after a point apply to that point.
      </p>
      <div className="odds-table">
        <div>
          <b>BET</b>
          <b>WIN</b>
          <b>EDGE</b>
        </div>
        {items.map((b) => (
          <div key={b.id}>
            <span>
              {b.name}
              <small>{b.payout}</small>
            </span>
            <span>{(b.prob * 100).toFixed(1)}%</span>
            <span>{b.edge.toFixed(2)}%</span>
          </div>
        ))}
      </div>
      <p className="muted">
        This house pays field 2 at 2:1 and field 12 at 3:1. Crapless places 2/12
        at 11:2 and 3/11 at 11:4. Table rules vary in real casinos. Every roll
        is independent.
      </p>
      <a
        href="https://www.mdgaming.com/wp-content/uploads/2026/04/Craps-Standard-Rules-Version-1.5-accessible.pdf"
        target="_blank"
        rel="noreferrer"
      >
        Craps rules reference ↗
      </a>
    </section>
  );
}

createRoot(document.getElementById("root")).render(<App />);
