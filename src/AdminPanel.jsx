import { Fragment, useEffect, useId, useRef, useState } from "react";
import {
  ArrowRight,
  BookOpen,
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  Clock3,
  Coins,
  Crown,
  Dices,
  LogOut,
  Monitor,
  Plus,
  Settings2,
  Users,
  Volume2,
  X,
} from "lucide-react";
import { MAX_BANKROLL_ADJUSTMENT, money } from "./game.js";
import DrinkIcon from "./DrinkIcon.jsx";
import {
  DEFAULT_DRINKING_RULES,
  DRINK_UNITS,
  validDrinkingRules,
} from "./drinking-mode.js";
import { DEFAULT_GRAPHICS } from "./graphics-settings.js";
import { MAX_JUKEBOX_QUEUE, MAX_SONG_COST } from "./jukebox-settings.js";
import {
  DESKTOP_DISPLAY,
  DISPLAY_GRAPHICS_OPTIONS,
  graphicsForDisplay,
} from "./display-build.js";
import { rollCooldownSecondsFor } from "./betting-window.js";
import {
  BOT_PERSONALITIES,
  BOT_SLIDERS,
  BOT_FAIR_PLAY_NOTE,
  botPersonalityOptions,
  normalizeBotOptions,
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
const BOT_CONTROLS = {
  risk: "Risk",
  variety: "Bet variety",
  generosity: "Drink generosity",
};
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

function RollTimingFields({
  seconds,
  setSeconds,
  pointSeconds,
  setPointSeconds,
  botDelay,
  setBotDelay,
  disabled,
}) {
  return (
    <>
      <h3>
        <Clock3 size={17} /> Time to bet
      </h3>
      <SecondsField
        label="Come-out window"
        value={seconds}
        onChange={setSeconds}
        disabled={disabled}
      />
      <SecondsField
        label="Point-on window"
        value={pointSeconds}
        onChange={setPointSeconds}
        disabled={disabled}
      />
      <SecondsField
        label="Bot roll delay"
        value={botDelay}
        onChange={setBotDelay}
        disabled={disabled}
      />
      <p>Bot shooters wait {Number(botDelay || 0)}s extra.</p>
    </>
  );
}

function drinkRuleDraft(saved) {
  return {
    ...saved,
    sipValue: saved.sipValue / 100,
    shotValue: saved.shotValue / 100,
    finishValue: saved.finishValue / 100,
  };
}

function readDrinkRules(draft) {
  const finishValue = Math.round(Number(draft.finishValue) * 100);
  const rules = {
    sipValue: Math.round(Number(draft.sipValue) * 100),
    shotValue: Math.round(Number(draft.shotValue) * 100),
    finishValue:
      !draft.finishEnabled && !(finishValue >= 100 && finishValue <= 100000000)
        ? DEFAULT_DRINKING_RULES.finishValue
        : finishValue,
    finishEnabled: draft.finishEnabled,
    offerMarkup: draft.offerMarkup === "" ? NaN : Number(draft.offerMarkup),
  };
  return validDrinkingRules(rules) ? rules : null;
}

function DrinkPriceFields({ rules, setRules }) {
  const update = (key, value) =>
    setRules((current) => ({ ...current, [key]: value }));
  return (
    <>
      <div className="ha-money-grid ha-drinking-prices">
        {DRINK_UNITS.filter(
          ({ id }) => id !== "finish" || rules.finishEnabled,
        ).map(({ id, label, valueKey }) => (
          <label key={id}>
            {label} value ($)
            <input
              type="number"
              inputMode="decimal"
              min="1"
              max="1000000"
              step="0.01"
              required
              value={rules[valueKey]}
              onChange={(event) => update(valueKey, event.target.value)}
            />
          </label>
        ))}
        <label>
          Drink assignment markup (%)
          <input
            type="number"
            inputMode="numeric"
            min="0"
            max="1000"
            step="1"
            required
            value={rules.offerMarkup}
            onChange={(event) => update("offerMarkup", event.target.value)}
          />
        </label>
      </div>
      <label className="toggle-label ha-drinking-finish">
        <span>Enable “Finish drink”</span>
        <input
          type="checkbox"
          checked={rules.finishEnabled}
          onChange={(event) => update("finishEnabled", event.target.checked)}
        />
      </label>
      <p className="ha-rule-help">
        Chip top-ups use the listed values. Markup applies to drink assignments.
      </p>
    </>
  );
}

function DrinkingSettings({ enabled, setEnabled, rules, setRules, disabled }) {
  return (
    <fieldset className="ha-drinking" disabled={disabled}>
      <button
        type="button"
        className="ha-drinking-toggle ha-control-row"
        aria-label="Drinking Mode"
        aria-pressed={enabled}
        onClick={() => setEnabled(!enabled)}
      >
        <DrinkIcon name="mode" size={24} />
        <span>
          <strong>Drinking Mode</strong>
          <small>Verified chip top-ups and drink assignments.</small>
        </span>
        <b>{enabled ? "On" : "Off"}</b>
      </button>
      {enabled && <DrinkPriceFields rules={rules} setRules={setRules} />}
    </fieldset>
  );
}

function LiveDrinkPrices({ saved, disabled, send }) {
  const [draft, setDraft] = useState(() => drinkRuleDraft(saved));
  const rules = readDrinkRules(draft);
  const unchanged =
    rules && Object.keys(rules).every((key) => rules[key] === saved[key]);
  return (
    <form
      className="ha-drinking"
      onSubmit={(event) => {
        event.preventDefault();
        if (rules && !disabled && !unchanged)
          send({ type: "drinking-rules", rules });
      }}
    >
      <fieldset disabled={disabled}>
        <legend className="ha-card-title">Drink prices</legend>
        <DrinkPriceFields rules={draft} setRules={setDraft} />
        <p className="ha-rule-help">Changes apply to new requests.</p>
        <button
          type="submit"
          className="button outline small"
          disabled={!rules || unchanged}
        >
          Save drink prices
        </button>
      </fieldset>
    </form>
  );
}

function BankrollForm({ id, player, disabled, send, close }) {
  const [direction, setDirection] = useState("add");
  const [dollars, setDollars] = useState("");
  const form = useRef(null);
  useEffect(() => {
    form.current.scrollIntoView({ block: "nearest" });
  }, []);
  const cents = /^(?:\d+|\d*\.\d{1,2})$/.test(dollars)
    ? Math.round(Number(dollars) * 100)
    : 0;
  const removing = direction === "remove";
  const exceedsBank = removing && cents > player.bank;
  const valid = cents > 0 && cents <= MAX_BANKROLL_ADJUSTMENT && !exceedsBank;
  function submit(event) {
    event.preventDefault();
    if (disabled || !valid) return;
    send({
      type: "adjust-bankroll",
      playerId: player.id,
      amount: removing ? -cents : cents,
    });
    setDollars("");
  }
  return (
    <form id={id} ref={form} className="ha-bot-form" onSubmit={submit}>
      <header>
        <h3>Adjust {player.name}’s chips</h3>
        <button
          type="button"
          className="ha-remove"
          aria-label="Close chip adjustment"
          onClick={close}
        >
          <X size={19} />
        </button>
      </header>
      <p className="ha-rule-help" aria-live="polite">
        {money(player.bank)} available
      </p>
      <label>
        Adjustment
        <select
          aria-label="Adjustment"
          value={direction}
          disabled={disabled}
          onChange={(event) => setDirection(event.target.value)}
        >
          <option value="add">Add chips</option>
          <option value="remove">Remove chips</option>
        </select>
      </label>
      <label>
        Amount ($)
        <input
          type="number"
          inputMode="decimal"
          min="0.01"
          max={MAX_BANKROLL_ADJUSTMENT / 100}
          step="0.01"
          required
          disabled={disabled}
          value={dollars}
          onChange={(event) => setDollars(event.target.value)}
        />
      </label>
      {exceedsBank && (
        <p className="ha-rule-help">Only available chips can be removed.</p>
      )}
      <button
        type="submit"
        className="button dark"
        disabled={disabled || !valid}
      >
        {removing ? "Remove chips" : "Add chips"}
      </button>
    </form>
  );
}

function PlayerSeats({
  state,
  connected,
  send,
  openTiming,
  onNotice,
  onFormChange,
  serverError,
  drinkingMode,
}) {
  const adjustmentId = useId();
  const [adding, setAdding] = useState(false),
    [adjusting, setAdjusting] = useState(null),
    [editing, setEditing] = useState(null),
    [name, setName] = useState(""),
    [personality, setPersonality] = useState(() => normalizeBotOptions()),
    [pending, setPending] = useState(false);
  const previousIds = useRef(new Set());
  const players = state.players.filter((p) => !p.left);
  const full = players.length >= 12;
  const disabled = !connected || state.rolling;
  const canAdjust = state.status === "playing";
  const selected = BOT_PERSONALITIES.find(
    (p) => p.id === personality.personality,
  );
  useEffect(() => {
    if (!pending) return;
    const updated = editing
      ? players.find(
          (p) =>
            p.id === editing &&
            JSON.stringify(p.bot) === JSON.stringify(personality),
        )
      : players.find((p) => p.bot && !previousIds.current.has(p.id));
    if (updated) {
      setPending(false);
      setAdding(false);
      onNotice(
        editing
          ? `${updated.name}’s personality saved.`
          : `${updated.name} joined the table.`,
      );
    }
  }, [state.players, pending, editing, personality]);
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
    if (disabled || pending || (!editing && (full || !name.trim()))) return;
    previousIds.current = new Set(players.map((p) => p.id));
    setPending(true);
    send(
      editing
        ? { type: "update-bot", playerId: editing, ...personality }
        : { type: "add-bot", name: name.trim(), ...personality },
    );
  }
  return (
    <div className="ha-players">
      <div className="ha-section-heading">
        <h3>At the table</h3>
      </div>
      {!adding && (
        <ul className="ha-roster" aria-label="Table players">
          {players.map((p) => (
            <Fragment key={p.id}>
              <li>
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
                      ? BOT_PERSONALITIES.find(
                          ({ id }) =>
                            id === botPersonalityOptions(p.bot).personality,
                        )?.name
                      : p.connected
                        ? "Player"
                        : "Reconnecting"}
                    {canAdjust && ` · ${money(p.bank)} available`}
                  </small>
                </div>
                {p.bot && (
                  <button
                    type="button"
                    className="ha-remove"
                    aria-label={`Edit ${p.name}’s personality`}
                    disabled={disabled}
                    onClick={() => {
                      setAdjusting(null);
                      setEditing(p.id);
                      setName(p.name);
                      setPersonality(botPersonalityOptions(p.bot));
                      setAdding(true);
                    }}
                  >
                    <Settings2 size={16} />
                  </button>
                )}
                {canAdjust && (
                  <button
                    type="button"
                    className="ha-adjust"
                    aria-label={`Adjust chips for ${p.name}`}
                    aria-expanded={p.id === adjusting}
                    aria-controls={
                      p.id === adjusting ? adjustmentId : undefined
                    }
                    disabled={disabled}
                    onClick={() =>
                      setAdjusting((current) =>
                        current === p.id ? null : p.id,
                      )
                    }
                  >
                    Adjust
                  </button>
                )}
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
              {canAdjust && p.id === adjusting && (
                <li className="ha-bankroll-editor">
                  <BankrollForm
                    id={adjustmentId}
                    player={p}
                    disabled={disabled}
                    send={send}
                    close={() => setAdjusting(null)}
                  />
                </li>
              )}
            </Fragment>
          ))}
        </ul>
      )}
      {!adding && (
        <button
          type="button"
          className="ha-add button outline"
          disabled={full || disabled}
          onClick={() => {
            setAdjusting(null);
            setEditing(null);
            setName(nextName(players));
            setPersonality(normalizeBotOptions());
            setAdding(true);
          }}
        >
          <Plus size={17} />
          {full ? "Table full (12/12)" : "Add bot"}
        </button>
      )}
      {adding && (
        <form className="ha-bot-form" onSubmit={add}>
          <header>
            <h3>{editing ? `Edit ${name}` : "Add a bot"}</h3>
            <button
              type="button"
              className="ha-remove"
              aria-label={editing ? "Cancel bot edit" : "Cancel add bot"}
              disabled={pending}
              onClick={() => setAdding(false)}
            >
              <X size={19} />
            </button>
          </header>
          {!editing && (
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
          )}
          <fieldset disabled={pending}>
            <legend>Personality preset</legend>
            <div className="ha-personality-grid">
              {BOT_PERSONALITIES.map((option) => (
                <button
                  type="button"
                  key={option.id}
                  aria-pressed={personality.personality === option.id}
                  aria-label={option.name}
                  onClick={() =>
                    setPersonality(
                      normalizeBotOptions({ personality: option.id }),
                    )
                  }
                >
                  <strong>{option.name}</strong>
                  {personality.personality === option.id && <Check size={13} />}
                </button>
              ))}
            </div>
          </fieldset>
          <p className="ha-choice-description" aria-live="polite">
            {selected?.description}
          </p>
          <fieldset className="ha-bot-sliders" disabled={pending || disabled}>
            <legend>Behavior</legend>
            {BOT_SLIDERS.filter(
              (key) => drinkingMode || key !== "generosity",
            ).map((key) => (
              <label key={key}>
                <span>
                  {BOT_CONTROLS[key]}{" "}
                  <b aria-hidden="true">{personality[key]}%</b>
                </span>
                <input
                  type="range"
                  aria-label={BOT_CONTROLS[key]}
                  min="0"
                  max="100"
                  value={personality[key]}
                  onChange={(event) => {
                    const value = Number(event.target.value);
                    setPersonality((current) => ({ ...current, [key]: value }));
                  }}
                />
              </label>
            ))}
          </fieldset>
          <button
            type="submit"
            className="button dark"
            disabled={
              disabled || pending || (!editing && (full || !name.trim()))
            }
          >
            {editing
              ? "Save personality"
              : pending
                ? "Seating bot…"
                : "Add to table"}
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

function MusicSettings({ settings, connected, onChange }) {
  const [cost, setCost] = useState(String(settings.cost / 100));
  const [limit, setLimit] = useState(String(settings.limit));
  useEffect(() => {
    setCost(String(settings.cost / 100));
    setLimit(String(settings.limit));
  }, [settings.cost, settings.limit]);
  const cents = Math.round(Number(cost) * 100);
  const max = Number(limit);
  const valid =
    cost.trim() !== "" &&
    Number.isSafeInteger(cents) &&
    cents >= 0 &&
    cents <= MAX_SONG_COST &&
    Number.isInteger(max) &&
    max >= 1 &&
    max <= MAX_JUKEBOX_QUEUE;
  return (
    <>
      <label className="toggle-label">
        <span>
          Music mode<small>Let players request songs.</small>
        </span>
        <input
          type="checkbox"
          aria-label="Music mode"
          checked={settings.enabled}
          disabled={!connected}
          onChange={(event) => onChange({ enabled: event.target.checked })}
        />
      </label>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (connected && valid) onChange({ cost: cents, limit: max });
        }}
      >
        <div className="ha-graphics-grid">
          <label>
            Chip cost per song ($)
            <input
              type="number"
              min="0"
              max={MAX_SONG_COST / 100}
              step="0.01"
              value={cost}
              onChange={(event) => setCost(event.target.value)}
              disabled={!connected}
            />
          </label>
          <label>
            Max queued songs per player
            <input
              type="number"
              min="1"
              max={MAX_JUKEBOX_QUEUE}
              step="1"
              value={limit}
              onChange={(event) => setLimit(event.target.value)}
              disabled={!connected}
            />
          </label>
        </div>
        <button
          type="submit"
          className="button outline small"
          disabled={
            !connected ||
            !valid ||
            (cents === settings.cost && max === settings.limit)
          }
        >
          Save music settings
        </button>
      </form>
    </>
  );
}

function TVSettings({
  state,
  send,
  connected,
  onDisplayAction,
  onTableAudio,
  musicSettings,
  onMusicSettings,
  fallbackJoinURL,
}) {
  const graphics = graphicsForDisplay(state.display?.graphics ?? {});
  const graphicsSummary = ["fps", "resolution"]
    .map(
      (key) =>
        DISPLAY_GRAPHICS_OPTIONS[key].find(
          (option) => option.value === graphics[key],
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
      <button
        type="button"
        className="ha-control-row ha-table-audio"
        aria-label="Table audio"
        onClick={onTableAudio}
        disabled={!connected || !onTableAudio}
      >
        <Volume2 size={20} />
        <span>
          <strong>Table audio</strong>
          <small>Music, ambience and sound effects.</small>
        </span>
        <ChevronRight size={18} />
      </button>
      {musicSettings && (
        <MusicSettings
          settings={musicSettings}
          connected={connected}
          onChange={onMusicSettings}
        />
      )}
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
              ...(DESKTOP_DISPLAY ? { upscaling: "Upscaling" } : {}),
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
                  value={graphics[key]}
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
                  {DISPLAY_GRAPHICS_OPTIONS[key].map((option) => (
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
  onTableAudio,
  musicSettings,
  onMusicSettings,
  fallbackJoinURL,
  serverError,
}) {
  const id = useId();
  const savedDrinkRules = state.config.drinkingRules ?? DEFAULT_DRINKING_RULES;
  const savedComeOut = rollCooldownSecondsFor(state.config, false);
  const savedPointOn = rollCooldownSecondsFor(state.config, true);
  const [drinkingMode, setDrinkingMode] = useState(!!state.config.drinkingMode);
  const [drinkingRules, setDrinkingRules] = useState(() =>
    drinkRuleDraft(savedDrinkRules),
  );
  const [tab, setTab] = useState("table"),
    [bank, setBank] = useState(state.config.startingBank / 100),
    [minimum, setMinimum] = useState(state.config.minBet / 100),
    [mode, setMode] = useState(state.config.mode),
    [teach, setTeach] = useState(state.config.teach),
    [seconds, setSeconds] = useState(savedComeOut),
    [pointSeconds, setPointSeconds] = useState(savedPointOn),
    [botDelay, setBotDelay] = useState(state.config.botRollDelaySeconds ?? 5),
    [notice, setNotice] = useState(""),
    [botFormOpen, setBotFormOpen] = useState(false);
  const lobby = state.status !== "playing",
    disabled = !connected || state.rolling;
  const players = state.players.filter((p) => !p.left),
    humans = players.filter((p) => !p.bot && p.id !== player.id);
  const rules = drinkingMode ? readDrinkRules(drinkingRules) : undefined;
  useEffect(() => setSeconds(savedComeOut), [savedComeOut]);
  useEffect(() => setPointSeconds(savedPointOn), [savedPointOn]);
  useEffect(
    () => setBotDelay(state.config.botRollDelaySeconds ?? 5),
    [state.config.botRollDelaySeconds],
  );
  useEffect(() => setTeach(state.config.teach), [state.config.teach]);
  function start(event) {
    event.preventDefault();
    if (disabled || !validSetup) return;
    send({
      type: "start",
      config: {
        ...(!drinkingMode && { startingBank: Math.round(Number(bank) * 100) }),
        minBet: Math.round(Number(minimum) * 100),
        mode,
        drinkingMode,
        ...(rules && { drinkingRules: rules }),
        teach,
        rollCooldownSeconds: Number(seconds),
        pointRollCooldownSeconds: Number(pointSeconds),
        botRollDelaySeconds: Number(botDelay),
      },
    });
  }
  function saveTiming(event) {
    event.preventDefault();
    if (disabled || !validTiming) return;
    send({
      type: "cooldown",
      seconds: Number(seconds),
      pointSeconds: Number(pointSeconds),
    });
    send({ type: "bot-delay", seconds: Number(botDelay) });
    setNotice("Timing saved.");
  }
  const validTiming = [seconds, pointSeconds, botDelay].every(
    (value) =>
      value !== "" &&
      Number.isInteger(Number(value)) &&
      Number(value) >= 0 &&
      Number(value) <= 60,
  );
  const validSetup =
    validTiming &&
    Number.isInteger(Number(minimum)) &&
    Number(minimum) >= 1 &&
    Number(minimum) <= (drinkingMode ? 1000000 : Number(bank)) &&
    (!drinkingMode
      ? Number.isInteger(Number(bank)) &&
        Number(bank) >= 10 &&
        Number(bank) <= 1000000
      : !!rules);
  const timingFields = (
    <RollTimingFields
      seconds={seconds}
      setSeconds={setSeconds}
      pointSeconds={pointSeconds}
      setPointSeconds={setPointSeconds}
      botDelay={botDelay}
      setBotDelay={setBotDelay}
      disabled={disabled}
    />
  );
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
                <fieldset className="ha-stakes" disabled={disabled}>
                  <legend className="ha-card-title">
                    <Coins size={17} aria-hidden="true" /> Table stakes
                  </legend>
                  <div className={drinkingMode ? "" : "ha-money-grid"}>
                    <label>
                      Table minimum ($)
                      <input
                        type="number"
                        inputMode="numeric"
                        min="1"
                        max={drinkingMode ? 1000000 : bank}
                        step="1"
                        required
                        value={minimum}
                        onChange={(e) => setMinimum(e.target.value)}
                      />
                    </label>
                    {!drinkingMode && (
                      <label>
                        Starting chips ($)
                        <input
                          type="number"
                          inputMode="numeric"
                          min="10"
                          max="1000000"
                          step="1"
                          required
                          value={bank}
                          onChange={(e) => setBank(e.target.value)}
                        />
                      </label>
                    )}
                  </div>
                </fieldset>
                <fieldset className="ha-game-rules" disabled={disabled}>
                  <legend className="ha-card-title">Game rules</legend>
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
                <DrinkingSettings
                  enabled={drinkingMode}
                  setEnabled={setDrinkingMode}
                  rules={drinkingRules}
                  setRules={setDrinkingRules}
                  disabled={disabled}
                />
                <div className="ha-timing">{timingFields}</div>
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
                  <span>
                    {state.config.drinkingMode
                      ? "Drinking Mode"
                      : `${money(state.config.startingBank)} starting`}
                  </span>
                </div>
                {state.config.drinkingMode && (
                  <LiveDrinkPrices
                    key={JSON.stringify(savedDrinkRules)}
                    saved={savedDrinkRules}
                    disabled={disabled}
                    send={send}
                  />
                )}
                <form className="ha-timing" onSubmit={saveTiming}>
                  {timingFields}
                  <button
                    type="submit"
                    className="button outline small"
                    disabled={disabled || !validTiming}
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
                {state.saveSessionAvailable && (
                  <button
                    type="button"
                    className="button outline"
                    disabled={disabled}
                    onClick={() => confirm("save-session")}
                  >
                    Save and close
                  </button>
                )}
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
            <PlayerSeats
              state={state}
              connected={connected}
              send={send}
              openTiming={() => setTab("table")}
              onNotice={setNotice}
              onFormChange={setBotFormOpen}
              serverError={serverError}
              drinkingMode={lobby ? drinkingMode : state.config.drinkingMode}
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
                      Another player can take over as host after joining.
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
            onTableAudio={onTableAudio}
            musicSettings={musicSettings}
            onMusicSettings={onMusicSettings}
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
            disabled={disabled || !validSetup}
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
