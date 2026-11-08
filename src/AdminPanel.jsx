import { useEffect, useId, useRef, useState } from "react";
import {
  ArrowRight,
  BookOpen,
  Bot,
  Check,
  ChevronDown,
  Clock3,
  Crown,
  Dices,
  LogOut,
  Monitor,
  Plus,
  Settings2,
  Users,
  X,
} from "lucide-react";
import { money } from "./game.js";
import { DEFAULT_GRAPHICS, GRAPHICS_OPTIONS } from "./graphics-settings.js";
import {
  BOT_STRATEGIES,
  BOT_DIFFICULTIES,
  DEFAULT_BOT_OPTIONS,
  BOT_FAIR_PLAY_NOTE,
} from "./bot-options.js";
import "./admin-panel.css";

const NAMES = [
  "Lucky Lou",
  "Ruby",
  "Boxcar Bea",
  "Vinny",
  "Milo",
  "Goldie",
  "Frankie",
  "Ace",
  "Cleo",
  "Nico",
  "Seven",
  "Sunny",
];
const STRATEGY_ICONS = {
  line: "↗",
  "six-eight": "6 · 8",
  "iron-cross": "+",
  press: "↑",
  "dark-side": "↘",
};
const optionName = (options, id) =>
  options.find((option) => option.id === id)?.name || id;
const nextName = (players) =>
  NAMES.find((name) => !players.some((p) => p.name === name)) || "New bot";

function SecondsField({ label, value, onChange, disabled }) {
  return (
    <label className="ha-seconds">
      <span>{label}</span>
      <span className="ha-stepper">
        <button
          type="button"
          aria-label={`Decrease ${label.toLowerCase()}`}
          disabled={disabled || Number(value) <= 0}
          onClick={() => onChange(Math.max(0, Number(value) - 1))}
        >
          −
        </button>
        <span>
          <input
            type="number"
            aria-label={`${label} (seconds)`}
            min="0"
            max="60"
            step="1"
            required
            value={value}
            disabled={disabled}
            onChange={(e) => onChange(e.target.value)}
          />
          <small>s</small>
        </span>
        <button
          type="button"
          aria-label={`Increase ${label.toLowerCase()}`}
          disabled={disabled || Number(value) >= 60}
          onClick={() => onChange(Math.min(60, Number(value) + 1))}
        >
          +
        </button>
      </span>
    </label>
  );
}

function BotSeats({
  state,
  connected,
  send,
  openTiming,
  onNotice,
  onFormChange,
  serverError,
  delay,
}) {
  const [adding, setAdding] = useState(false),
    [name, setName] = useState(""),
    [strategy, setStrategy] = useState(DEFAULT_BOT_OPTIONS.strategy),
    [difficulty, setDifficulty] = useState(DEFAULT_BOT_OPTIONS.difficulty),
    [pending, setPending] = useState(false);
  const previousIds = useRef(new Set());
  const players = state.players.filter((p) => !p.left);
  const full = players.length >= 12;
  const disabled = !connected || state.rolling;
  const selected = BOT_STRATEGIES.find((option) => option.id === strategy);
  useEffect(() => {
    if (!pending) return;
    const added = players.find((p) => p.bot && !previousIds.current.has(p.id));
    if (added) {
      setPending(false);
      setAdding(false);
      onNotice(`${added.name} joined the table.`);
    }
  }, [state.players, pending]);
  useEffect(() => {
    if (!connected) setPending(false);
  }, [connected]);
  useEffect(() => {
    onFormChange(adding);
    return () => onFormChange(false);
  }, [adding, onFormChange]);
  useEffect(() => {
    if (serverError) setPending(false);
  }, [serverError, pending]);
  useEffect(() => {
    if (!pending) return;
    const timeout = setTimeout(() => setPending(false), 5000);
    return () => clearTimeout(timeout);
  }, [pending]);
  function add(event) {
    event.preventDefault();
    if (disabled || full || pending || !name.trim()) return;
    previousIds.current = new Set(players.map((p) => p.id));
    setPending(true);
    send({ type: "add-bot", name: name.trim(), strategy, difficulty });
  }
  return (
    <div className="ha-players">
      <div className="ha-section-heading">
        <div>
          <h3>At the table</h3>
          <p>People and bots share the same chips and rules.</p>
        </div>
      </div>
      {!adding && (
        <ul className="ha-roster" aria-label="Table players">
          {players.map((p) => (
            <li key={p.id}>
              <span
                className={`ha-avatar ${p.bot ? "is-bot" : ""}`}
                style={!p.bot ? { "--player-color": p.color } : undefined}
              >
                {p.bot ? <Bot size={20} /> : p.name[0]}
              </span>
              <div>
                <strong>
                  {p.name}
                  {p.id === state.adminId && (
                    <Crown size={13} aria-label="Host" />
                  )}
                </strong>
                <small>
                  {p.bot
                    ? `${optionName(BOT_STRATEGIES, p.bot.strategy)} · ${optionName(BOT_DIFFICULTIES, p.bot.difficulty)}`
                    : p.connected
                      ? "Player"
                      : "Reconnecting"}
                </small>
              </div>
              {p.bot && (
                <button
                  type="button"
                  className="ha-remove"
                  aria-label={`Remove ${p.name}`}
                  disabled={disabled}
                  onClick={() => send({ type: "remove-bot", playerId: p.id })}
                >
                  <X size={18} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {!adding ? (
        <button
          type="button"
          className="ha-add button outline"
          disabled={full || disabled}
          onClick={() => {
            setName(nextName(players));
            setAdding(true);
          }}
        >
          <Plus size={17} />
          {full ? "Table full (12/12)" : "Add bot"}
        </button>
      ) : (
        <form className="ha-bot-form" onSubmit={add}>
          <header>
            <h3>Add a bot</h3>
            <button
              type="button"
              className="ha-remove"
              aria-label="Cancel add bot"
              disabled={pending}
              onClick={() => setAdding(false)}
            >
              <X size={19} />
            </button>
          </header>
          <label>
            Bot name
            <input
              autoComplete="off"
              maxLength={20}
              value={name}
              disabled={pending}
              required
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <fieldset disabled={pending}>
            <legend>Bot strategy</legend>
            <div className="ha-strategy-grid">
              {BOT_STRATEGIES.map((option) => (
                <button
                  type="button"
                  key={option.id}
                  aria-pressed={strategy === option.id}
                  aria-label={option.name}
                  onClick={() => setStrategy(option.id)}
                >
                  <span aria-hidden="true">{STRATEGY_ICONS[option.id]}</span>
                  <strong>{option.name}</strong>
                  {strategy === option.id && <Check size={13} />}
                </button>
              ))}
            </div>
          </fieldset>
          <p className="ha-choice-description" aria-live="polite">
            {selected?.description}
          </p>
          <fieldset disabled={pending}>
            <legend>Difficulty</legend>
            <div className="ha-difficulty">
              {BOT_DIFFICULTIES.map((option) => (
                <button
                  type="button"
                  key={option.id}
                  aria-pressed={difficulty === option.id}
                  onClick={() => setDifficulty(option.id)}
                >
                  {option.name}
                </button>
              ))}
            </div>
          </fieldset>
          <p className="ha-choice-description" aria-live="polite">
            {
              BOT_DIFFICULTIES.find((option) => option.id === difficulty)
                ?.description
            }
          </p>
          <button
            type="submit"
            className="button dark"
            disabled={disabled || full || pending || !name.trim()}
          >
            {pending ? "Seating bot…" : "Add to table"}
            <ArrowRight size={17} />
          </button>
        </form>
      )}
      <p className="ha-note">
        <Clock3 size={15} />
        <span>
          Bots wait an extra {state.config.botRollDelaySeconds ?? 5}s before
          rolling.{" "}
          <button type="button" onClick={openTiming}>
            Change timing
          </button>
        </span>
      </p>
      <p className="ha-fair-play">{BOT_FAIR_PLAY_NOTE}</p>
    </div>
  );
}

function TVSettings({
  state,
  send,
  connected,
  onDisplayAction,
  fallbackJoinURL,
}) {
  const graphicsSummary = ["fps", "resolution"]
    .map(
      (key) =>
        GRAPHICS_OPTIONS[key].find(
          (option) =>
            option.value ===
            (state.display?.graphics?.[key] ?? DEFAULT_GRAPHICS[key]),
        )?.label || "Auto",
    )
    .join(" · ");
  return (
    <div className="ha-tv">
      <div className="ha-section-heading">
        <div>
          <h3>TV & sound</h3>
          <p>Changes apply to the shared display.</p>
        </div>
        <Monitor size={22} />
      </div>
      <label className="toggle-label">
        <span>
          TV announcer<small>Call out rolls and results.</small>
        </span>
        <input
          aria-label="TV announcer"
          type="checkbox"
          checked={state.display?.sound || false}
          disabled={!connected}
          onChange={(e) =>
            send({ type: "display", settings: { sound: e.target.checked } })
          }
        />
      </label>
      <label>
        TV camera
        <select
          aria-label="TV camera"
          value={state.display?.camera || "auto"}
          disabled={!connected}
          onChange={(e) =>
            send({ type: "display", settings: { camera: e.target.value } })
          }
        >
          <option value="auto">Auto · directed shots</option>
          <option value="table">Table · overhead</option>
          <option value="room">Room · wide view</option>
        </select>
      </label>
      <details className="ha-disclosure">
        <summary>
          <Settings2 size={17} />
          <span>
            Graphics & effects<small>{graphicsSummary}</small>
          </span>
          <ChevronDown size={16} />
        </summary>
        <div>
          <p className="ha-fair-play">
            Auto checks the TV and keeps settings suited to that display. Saved
            On/Off choices stay fixed.
          </p>
          <div className="ha-graphics-grid">
            {Object.entries({
              fps: "Frame rate",
              antialias: "Antialiasing",
              resolution: "Resolution",
              modelDetail: "Model detail",
              textures: "Textures",
              lensFlares: "Lens flares",
              localReflections: "Local reflections",
              contactShadows: "Contact shadows",
            }).map(([key, label]) => (
              <label key={key}>
                {label}
                <select
                  aria-label={`TV graphics ${label.toLowerCase()}`}
                  value={
                    state.display?.graphics?.[key] ?? DEFAULT_GRAPHICS[key]
                  }
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
          </div>
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
      </details>
      <div className="ha-invite-actions">
        <button type="button" onClick={() => onDisplayAction("copy")}>
          Copy invite
        </button>
        {fallbackJoinURL && (
          <button type="button" onClick={() => onDisplayAction("copy-ip")}>
            Copy IP invite
          </button>
        )}
        <button type="button" onClick={() => onDisplayAction("join")}>
          Controller
        </button>
        <button type="button" onClick={() => onDisplayAction("fullscreen")}>
          Fullscreen this device
        </button>
      </div>
    </div>
  );
}

export default function AdminPanel({
  state,
  player,
  send,
  connected,
  confirm,
  onDisplayAction,
  fallbackJoinURL,
  serverError,
}) {
  const id = useId();
  const [tab, setTab] = useState("table"),
    [bank, setBank] = useState(state.config.startingBank / 100),
    [minimum, setMinimum] = useState(state.config.minBet / 100),
    [mode, setMode] = useState(state.config.mode),
    [teach, setTeach] = useState(state.config.teach),
    [seconds, setSeconds] = useState(state.config.rollCooldownSeconds ?? 10),
    [botDelay, setBotDelay] = useState(state.config.botRollDelaySeconds ?? 5),
    [notice, setNotice] = useState(""),
    [botFormOpen, setBotFormOpen] = useState(false);
  const lobby = state.status !== "playing",
    disabled = !connected || state.rolling;
  const players = state.players.filter((p) => !p.left),
    humans = players.filter((p) => !p.bot && p.id !== player.id);
  useEffect(
    () => setSeconds(state.config.rollCooldownSeconds ?? 10),
    [state.config.rollCooldownSeconds],
  );
  useEffect(
    () => setBotDelay(state.config.botRollDelaySeconds ?? 5),
    [state.config.botRollDelaySeconds],
  );
  useEffect(() => setTeach(state.config.teach), [state.config.teach]);
  function start(event) {
    event.preventDefault();
    send({
      type: "start",
      config: {
        startingBank: Math.round(Number(bank) * 100),
        minBet: Math.round(Number(minimum) * 100),
        mode,
        teach,
        rollCooldownSeconds: Number(seconds),
        botRollDelaySeconds: Number(botDelay),
      },
    });
  }
  function saveTiming(event) {
    event.preventDefault();
    send({ type: "cooldown", seconds: Number(seconds) });
    send({ type: "bot-delay", seconds: Number(botDelay) });
    setNotice("Timing saved.");
  }
  const valid =
    seconds !== "" &&
    botDelay !== "" &&
    Number(bank) >= 10 &&
    Number(bank) <= 1000000 &&
    Number(minimum) >= 1 &&
    Number(minimum) <= Number(bank) &&
    Number.isInteger(Number(seconds)) &&
    Number.isInteger(Number(botDelay)) &&
    Number(seconds) >= 0 &&
    Number(seconds) <= 60 &&
    Number(botDelay) >= 0 &&
    Number(botDelay) <= 60;
  return (
    <section
      className={`ha-panel ${lobby ? "is-lobby setup" : ""}`}
      aria-label="Host controls"
    >
      <header className="ha-header">
        <div>
          <span>
            <Crown size={14} /> HOST
          </span>
          <h2>{lobby ? "Table setup" : "Your table"}</h2>
        </div>
        <button
          type="button"
          className="ha-seat-count"
          onClick={() => setTab("players")}
          aria-label={`${players.length} of 12 seats, show players`}
        >
          <Users size={16} />
          {players.length}
          <small>/12</small>
        </button>
      </header>
      <div role="tablist" aria-label="Host sections" className="ha-tabs">
        {[
          { id: "table", name: "Table", icon: Dices },
          { id: "players", name: "Players", icon: Users },
          { id: "tv", name: "TV", icon: Monitor },
        ].map(({ id: key, name, icon: Icon }) => (
          <button
            type="button"
            role="tab"
            key={key}
            id={`${id}-tab-${key}`}
            aria-controls={`${id}-panel-${key}`}
            aria-selected={tab === key}
            onClick={() => {
              setTab(key);
              setNotice("");
            }}
          >
            <Icon size={17} />
            {name}
          </button>
        ))}
      </div>
      <div
        className="ha-tab-content"
        role="tabpanel"
        id={`${id}-panel-${tab}`}
        aria-labelledby={`${id}-tab-${tab}`}
      >
        {tab === "table" && (
          <>
            {lobby ? (
              <form id={`${id}-setup`} onSubmit={start} className="ha-rules">
                <fieldset disabled={!connected}>
                  <legend>Game</legend>
                  <div className="ha-mode-grid">
                    {[
                      [
                        "craps",
                        "Classic craps",
                        "7 or 11 wins on the come-out.",
                      ],
                      [
                        "crapless",
                        "Crapless craps",
                        "Any number except 7 can be the point.",
                      ],
                    ].map(([value, label, description]) => (
                      <button
                        type="button"
                        key={value}
                        aria-pressed={mode === value}
                        onClick={() => setMode(value)}
                      >
                        <strong>
                          {label}
                          {mode === value && <Check size={14} />}
                        </strong>
                        <small>{description}</small>
                      </button>
                    ))}
                  </div>
                </fieldset>
                <div className="ha-money-grid">
                  <label>
                    Starting chips ($)
                    <input
                      type="number"
                      min="10"
                      max="1000000"
                      step="1"
                      required
                      value={bank}
                      disabled={!connected}
                      onChange={(e) => setBank(e.target.value)}
                    />
                  </label>
                  <label>
                    Table minimum ($)
                    <input
                      type="number"
                      min="1"
                      max={bank}
                      step="1"
                      required
                      value={minimum}
                      disabled={!connected}
                      onChange={(e) => setMinimum(e.target.value)}
                    />
                  </label>
                </div>
                <div className="ha-timing">
                  <SecondsField
                    label="Betting window"
                    value={seconds}
                    onChange={setSeconds}
                    disabled={!connected}
                  />
                  <SecondsField
                    label="Bot roll delay"
                    value={botDelay}
                    onChange={setBotDelay}
                    disabled={!connected}
                  />
                  <p>
                    Bots roll after{" "}
                    {Number(seconds || 0) + Number(botDelay || 0)}s: the betting
                    window, plus their extra wait.
                  </p>
                </div>
                <label className="toggle-label ha-teach">
                  <span>
                    <BookOpen size={18} />
                    <span>
                      Teach mode
                      <small>Show odds and payout help on phones.</small>
                    </span>
                  </span>
                  <input
                    aria-label="Teach mode"
                    type="checkbox"
                    checked={teach}
                    disabled={!connected}
                    onChange={(e) => setTeach(e.target.checked)}
                  />
                </label>
              </form>
            ) : (
              <>
                <div className="ha-rule-summary">
                  <span>
                    {state.config.mode === "crapless"
                      ? "Crapless"
                      : "Classic craps"}
                  </span>
                  <span>{money(state.config.minBet)} minimum</span>
                  <span>{money(state.config.startingBank)} starting</span>
                </div>
                <form className="ha-timing" onSubmit={saveTiming}>
                  <h3>
                    <Clock3 size={17} /> Time to bet
                  </h3>
                  <SecondsField
                    label="Betting window"
                    value={seconds}
                    onChange={setSeconds}
                    disabled={!connected}
                  />
                  <SecondsField
                    label="Bot roll delay"
                    value={botDelay}
                    onChange={setBotDelay}
                    disabled={!connected}
                  />
                  <p>
                    Extra time for people before a bot shooter rolls. Total
                    wait: {Number(seconds || 0) + Number(botDelay || 0)}s.
                  </p>
                  <button
                    type="submit"
                    className="button outline small"
                    disabled={!connected || !valid}
                  >
                    Save timing
                  </button>
                </form>
                <label className="toggle-label ha-teach">
                  <span>
                    <BookOpen size={18} />
                    <span>
                      Teach mode
                      <small>Show odds and payout help on phones.</small>
                    </span>
                  </span>
                  <input
                    aria-label="Teach mode"
                    type="checkbox"
                    checked={state.config.teach}
                    disabled={!connected}
                    onChange={(e) =>
                      send({ type: "teach", value: e.target.checked })
                    }
                  />
                </label>
              </>
            )}
            <details className="ha-disclosure ha-management">
              <summary>
                <Crown size={16} />
                <span>Host & session</span>
                <ChevronDown size={16} />
              </summary>
              <div>
                {!lobby && (
                  <button
                    type="button"
                    className="button outline ha-danger"
                    disabled={disabled}
                    onClick={() => confirm("end")}
                  >
                    Close table for everyone
                  </button>
                )}
                <button
                  type="button"
                  className="text-button"
                  disabled={disabled}
                  onClick={() => confirm("leave")}
                >
                  <LogOut size={15} />
                  Cash out & leave
                </button>
              </div>
            </details>
          </>
        )}
        {tab === "players" && (
          <>
            <BotSeats
              state={state}
              connected={connected}
              send={send}
              openTiming={() => setTab("table")}
              onNotice={setNotice}
              onFormChange={setBotFormOpen}
              serverError={serverError}
            />
            {!botFormOpen && (
              <details className="ha-disclosure">
                <summary>
                  <Crown size={16} />
                  <span>Pass host controls</span>
                  <ChevronDown size={16} />
                </summary>
                <div>
                  {humans.length ? (
                    <label>
                      Pass host controls
                      <select
                        aria-label="Pass host controls"
                        value=""
                        disabled={disabled}
                        onChange={(e) => {
                          if (e.target.value)
                            send({
                              type: "transfer",
                              playerId: e.target.value,
                            });
                        }}
                      >
                        <option value="" disabled>
                          Choose a player
                        </option>
                        {humans.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                            {!p.connected ? " (offline)" : ""}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : (
                    <p className="ha-fair-play">
                      Another person can take over as host when they join. Bots
                      cannot host.
                    </p>
                  )}
                </div>
              </details>
            )}
          </>
        )}
        {tab === "tv" && (
          <TVSettings
            state={state}
            send={send}
            connected={connected}
            onDisplayAction={onDisplayAction}
            fallbackJoinURL={fallbackJoinURL}
          />
        )}
      </div>
      <p className="ha-status" aria-live="polite">
        {serverError ||
          notice ||
          (!connected
            ? "Reconnecting. Host controls are paused."
            : state.rolling
              ? "Dice are rolling. Player changes are paused."
              : "")}
      </p>
      {lobby && !botFormOpen && (
        <footer className="ha-start">
          <button
            type="submit"
            form={`${id}-setup`}
            className="button dark jumbo"
            disabled={!connected || !valid}
            onClick={tab !== "table" ? start : undefined}
          >
            Open the table
            <ArrowRight size={18} />
          </button>
          <small>
            {players.length} {players.length === 1 ? "seat" : "seats"} ·{" "}
            {mode === "crapless" ? "Crapless" : "Classic craps"}
          </small>
        </footer>
      )}
    </section>
  );
}
