import { assetURL } from "./asset-url.js";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useLayoutEffect,
  useRef,
  useState,
  lazy,
  Suspense,
} from "react";
import {
  ArrowDown,
  ArrowUp,
  BookOpen,
  ChevronDown,
  CircleDot,
  Coins,
  Dices,
  Equal,
  Lock,
  Plus,
  RefreshCw,
  Settings,
  Undo2,
  X,
} from "lucide-react";
import { validBetChoices } from "./bet-options.js";
import { catalogue, describeBet, equity, money, net } from "./game.js";
import {
  freshMobileSettlement,
  MOBILE_DICE_HOLD_MS,
  MOBILE_PAYOUT_HOLD_MS,
  MOBILE_PAYOUT_FLIGHT_MS,
  MOBILE_PAYOUT_STAGGER_MS,
} from "./mobile-settlement.js";
import "./phone-game.css";
const LearnCenter = lazy(() => import("./LearnCenter.jsx"));

const TRAY = [100, 500, 2500, 10000];
const THUMBNAILS = [100, 500, 2500, 10000, 50000];
const CHIP_TINT = {
  100: "#eee8dc",
  500: "#a9112e",
  2500: "#087342",
  10000: "#111722",
  50000: "#6d36a5",
};
const LINE_TYPES = ["pass", "dont", "come", "dontcome"];
const BOARD_IDS = new Set(["pass", "dont", "come", "dontcome", "field"]);
const FIELD_NUMBERS = [2, 3, 4, 9, 10, 11, 12];
const PLACE_WORDS = { 6: "SIX", 9: "NINE" };
const PRACTICE_MIN = 500;
// Keeps previews under 10/sec and clear of the server's 90ms drop window.
const PREVIEW_INTERVAL = 110;
const PREVIEW_VERIFY = 350;

const ChipImages = createContext(null);

const sum = (values) => values.reduce((n, v) => n + v, 0);
const chipFor = (amount) =>
  [...THUMBNAILS].reverse().find((value) => amount >= value) || THUMBNAILS[0];
const compact = (amount) =>
  amount >= 1000000 ? `$${(amount / 100000).toFixed(1)}k` : money(amount);
const signed = (delta) => `${delta >= 0 ? "+" : "−"}${money(Math.abs(delta))}`;
const isPlaceRow = (row) => row.id.startsWith("place-");
const isBoardRow = (row) => BOARD_IDS.has(row.id) || isPlaceRow(row);

// A bundle is the list of chips the player tapped, so undo removes the last one.
function chipsForAmount(amount) {
  if (amount <= 0 || amount % 100) return [];
  const chips = [];
  let remainder = amount;
  for (const value of [...TRAY].reverse())
    while (remainder >= value) {
      chips.push(value);
      remainder -= value;
    }
  return chips;
}

function useChipThumbnails() {
  return useMemo(
    () =>
      Object.fromEntries(
        THUMBNAILS.map((value) => [value, assetURL(`chip-${value}.png`)]),
      ),
    [],
  );
}

function Chip({ value, label }) {
  const images = useContext(ChipImages);
  return (
    <span className="pg-chip" aria-hidden="true">
      {images?.[value] ? (
        <img src={images[value]} alt="" draggable={false} />
      ) : (
        <span
          className="pg-chip-fallback"
          style={{ "--tint": CHIP_TINT[value] }}
        />
      )}
      {label && <b className="pg-chip-label">{label}</b>}
    </span>
  );
}

function Die({ value }) {
  return (
    <span className="pg-die" role="img" aria-label={`Die showing ${value}`}>
      {Array.from({ length: 9 }, (_, i) => (
        <i
          key={i}
          className={PIPS[value]?.includes(i) ? "on" : ""}
          aria-hidden="true"
        />
      ))}
    </span>
  );
}
const PIPS = {
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
};

// Everything the rules engine would reject for this exact amount. Nothing here
// changes the amount; `lower`/`upper` are only offered to the player as buttons.
function betIssue(row, amount, { player, state, connected }) {
  if (!connected) return { text: "Reconnecting. Bets are paused." };
  if (state.rolling) return { text: "Dice are out. Bets are locked." };
  if (!row.available) return { text: `${row.name}: ${unavailableLabel(row)}.` };
  if (amount <= 0) return { text: "Tap chips to build a bet first." };
  const choices = validBetChoices(row, amount, player);
  if (choices.valid) return null;
  const { lower, upper, minimum, maximum, step } = choices;
  let text = choices.reason;
  if (lower !== null || upper !== null) {
    if (amount > maximum) text = `${row.name} can take ${money(maximum)} now.`;
    else if (amount < minimum)
      text = `${row.name} minimum is ${money(minimum)}.`;
    else text = `${row.name} goes up in ${money(step)} steps.`;
  }
  return { text, lower, upper };
}

function unavailableLabel(row) {
  if (row.available) return "";
  return row.id === "come" || row.id === "dontcome"
    ? "after a point"
    : "come-out only";
}

function stakeTotals(bets) {
  const totals = {};
  for (const b of bets) {
    const key = b.type === "odds" ? `odds:${b.parent}` : b.type;
    totals[key] = (totals[key] || 0) + b.amount;
  }
  return totals;
}

function useChipDrag({ enabled, onDrop, ghostAmount }) {
  const [dragging, setDragging] = useState(false),
    [hoverId, setHoverId] = useState(null);
  const gesture = useRef(null),
    ghost = useRef(null),
    position = useRef({ x: 0, y: 0 }),
    suppressClick = useRef(false);
  const paint = () => {
    if (!ghost.current) return;
    const { x, y } = position.current;
    ghost.current.style.transform = `translate3d(${x}px, ${y}px, 0)`;
  };
  const cancel = useCallback(() => {
    gesture.current = null;
    setDragging(false);
    setHoverId(null);
  }, []);
  useEffect(() => {
    if (!enabled && gesture.current) cancel();
  }, [enabled, cancel]);
  useEffect(() => {
    if (!dragging) return undefined;
    const onKey = (event) => event.key === "Escape" && cancel();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dragging, cancel]);
  const targetAt = (x, y) =>
    document.elementFromPoint(x, y)?.closest?.("[data-bet-id]")?.dataset
      .betId || null;
  const handlers = {
    onPointerDown(event) {
      if (!enabled || event.button > 0) return;
      event.currentTarget.setPointerCapture?.(event.pointerId);
      gesture.current = {
        id: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        live: false,
      };
    },
    onPointerMove(event) {
      const g = gesture.current;
      if (!g || g.id !== event.pointerId) return;
      position.current = { x: event.clientX, y: event.clientY };
      if (
        !g.live &&
        Math.hypot(event.clientX - g.startX, event.clientY - g.startY) > 6
      ) {
        g.live = true;
        suppressClick.current = true;
        setDragging(true);
      }
      if (!g.live) return;
      paint();
      setHoverId(targetAt(event.clientX, event.clientY));
    },
    onPointerUp(event) {
      const g = gesture.current;
      if (!g || g.id !== event.pointerId) return;
      const target = g.live ? targetAt(event.clientX, event.clientY) : null;
      cancel();
      if (target) onDrop(target);
    },
    onPointerCancel: cancel,
    onClickCapture(event) {
      if (!suppressClick.current) return;
      suppressClick.current = false;
      event.preventDefault();
      event.stopPropagation();
    },
  };
  const ghostNode = dragging ? (
    <div
      className="pg-ghost"
      aria-hidden="true"
      ref={(el) => {
        ghost.current = el;
        paint();
      }}
    >
      <div className="pg-ghost-inner">
        <Chip value={chipFor(ghostAmount)} />
        <b>{money(ghostAmount)}</b>
      </div>
    </div>
  ) : null;
  return { dragging, hoverId, handlers, ghostNode };
}

// Display-only: tells the TV what this player is holding. Never places a bet.
function useBetPreview({ send, echo, canSend, held, amount, betId }) {
  const target = amount > 0 ? betId || null : null;
  const key = `${amount}:${target || ""}`;
  const sent = useRef({ key: "0:", at: 0, retries: 0 }),
    timer = useRef(null),
    latest = useRef(null);
  latest.current = { send, echo, canSend, held, amount, target, key };
  const flush = useCallback(() => {
    timer.current = null;
    const now = latest.current,
      last = sent.current;
    if (!now.canSend || now.held) return;
    const echoed = now.echo
      ? `${now.echo.amount}:${now.echo.betId || ""}`
      : "0:";
    if (last.key === now.key) {
      // The server drops updates that land too close together, so a final
      // value is resent if it never came back in state.
      if (echoed === now.key || last.retries >= 2) return;
      last.retries += 1;
    } else last.retries = 0;
    now.send({ type: "bet-preview", amount: now.amount, betId: now.target });
    last.key = now.key;
    last.at = Date.now();
    timer.current = setTimeout(flush, PREVIEW_VERIFY);
  }, []);
  useEffect(() => {
    clearTimeout(timer.current);
    timer.current = null;
    // The server clears previews itself when dice fly or a player disconnects.
    if (!canSend) sent.current.key = "0:";
    if (!canSend || held || sent.current.key === key) return;
    const wait = PREVIEW_INTERVAL - (Date.now() - sent.current.at);
    timer.current = setTimeout(flush, Math.max(0, wait));
  }, [key, canSend, held, flush]);
  useEffect(() => () => clearTimeout(timer.current), []);
}

function Stake({ amount, count }) {
  if (!amount) return null;
  return (
    <span className="pg-stake">
      <Chip value={chipFor(amount)} />
      <b>{compact(amount)}</b>
      {count > 1 && <small>×{count}</small>}
    </span>
  );
}

function BetTile({
  row,
  stake,
  count,
  selected,
  hovered,
  eligible,
  dragging,
  teach,
  className = "",
  cue,
  disabled,
  note,
  onSelect,
  children,
}) {
  const state = [
    selected && "is-selected",
    hovered && (eligible ? "is-drop" : "is-reject"),
    dragging && eligible && "is-eligible",
    dragging && !eligible && "is-dim",
    !row.available && "is-unavailable",
    cue && "is-cue",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <button
      type="button"
      data-bet-id={row.id}
      className={`pg-tile ${className} ${state}`}
      aria-pressed={!!selected}
      disabled={disabled}
      aria-label={`${row.name}${
        row.available ? "" : `, ${unavailableLabel(row)}`
      }${stake ? `, your stake ${money(stake)}` : ""}${note ? `, ${note}` : ""}`}
      onClick={() => onSelect(row)}
    >
      {children}
      {teach && (
        <small className="pg-tile-pay">{row.payout.split(" · ")[0]}</small>
      )}
      {!row.available && (
        <small className="pg-tile-off">{unavailableLabel(row)}</small>
      )}
      <Stake amount={stake} count={count} />
    </button>
  );
}

function Tray({ amount, bank, locked, onAdd, cue }) {
  return (
    <div className="pg-tray" role="group" aria-label="Chip tray">
      {TRAY.map((value) => (
        <button
          type="button"
          key={value}
          className={`pg-pile ${cue ? "is-cue" : ""}`}
          aria-label={`Add ${money(value)} chip`}
          disabled={locked || amount + value > bank}
          onClick={() => onAdd(value)}
        >
          <span className="pg-pile-stack">
            <Chip value={value} />
            <Chip value={value} />
            <Chip value={value} />
          </span>
          <b>{money(value)}</b>
        </button>
      ))}
    </div>
  );
}

function BundleBar({
  chips,
  amount,
  locked,
  drag,
  placeLabel,
  placeDetail,
  canPlace,
  onPlace,
  onUndo,
  onClear,
  onHint,
  quick,
  cue,
}) {
  return (
    <div className="pg-bundle-bar">
      {amount > 0 ? (
        <button
          type="button"
          className={`pg-bundle ${drag.dragging ? "is-lifted" : ""} ${
            cue ? "is-cue" : ""
          }`}
          disabled={locked}
          aria-label={`Bundle of ${money(amount)}. Drag onto a bet, or tap a bet and press Place.`}
          onClick={onHint}
          {...drag.handlers}
        >
          <span className="pg-bundle-stack" aria-hidden="true">
            {chips.slice(-4).map((value, i) => (
              <Chip key={`${value}-${i}`} value={value} />
            ))}
          </span>
          <span className="pg-bundle-amount">
            <b>{money(amount)}</b>
            <small>Drag to bet</small>
          </span>
        </button>
      ) : (
        <div className="pg-bundle is-empty">
          {quick.length ? (
            quick.map(({ label, value }) => (
              <button
                type="button"
                key={label}
                className="pg-quick"
                disabled={locked}
                onClick={() => value()}
              >
                {label}
              </button>
            ))
          ) : (
            <small>Tap chips below</small>
          )}
        </div>
      )}
      <div className="pg-bundle-tools">
        <button
          type="button"
          className="pg-icon"
          aria-label="Remove last chip"
          disabled={!amount || locked}
          onClick={onUndo}
        >
          <Undo2 size={18} />
        </button>
        <button
          type="button"
          className="pg-icon"
          aria-label="Clear bundle"
          disabled={!amount || locked}
          onClick={onClear}
        >
          <X size={18} />
        </button>
      </div>
      <button
        type="button"
        className="pg-place"
        disabled={!canPlace}
        onClick={onPlace}
      >
        <b>{placeLabel}</b>
        {placeDetail && <small>{placeDetail}</small>}
      </button>
    </div>
  );
}

function Notice({ notice, fallback, onBet, locked }) {
  const tone = notice?.tone || "hint",
    row = notice?.row;
  const choices = row
    ? [
        ["Bet less", notice.lower],
        ["Bet more", notice.upper],
      ].filter(([, value]) => value != null)
    : [];
  return (
    <div
      className={`pg-notice is-${tone}`}
      role={tone === "error" ? "alert" : "status"}
    >
      <span>{notice?.text || fallback}</span>
      {choices.length > 0 && (
        <div className="pg-notice-choices">
          {choices.map(([label, value]) => (
            <button
              type="button"
              key={label}
              className="pg-notice-fix"
              disabled={locked}
              aria-label={`${label}: ${money(value)} on ${row.name}`}
              onClick={() => onBet(row, value)}
            >
              {label} · {money(value)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function QuickBets({ row, player, onBet, detail }) {
  const { quick } = validBetChoices(row, 0, player);
  if (!quick.length) return null;
  return (
    <div
      className="pg-quickbets"
      role="group"
      aria-label={`Quick bets on ${row.name}`}
    >
      <span>
        {row.name}
        {detail && <small>{detail}</small>}
      </span>
      {quick.map((value) => (
        <button
          type="button"
          key={value}
          aria-label={`Bet ${money(value)} on ${row.name}`}
          onClick={() => onBet(row, value)}
        >
          Bet {money(value)}
        </button>
      ))}
    </div>
  );
}

// What a line bet's odds row can still accept, read from the authoritative row.
function oddsCapacity(row, stake, player) {
  const { minimum, maximum } = validBetChoices(row, 0, player);
  if (maximum >= minimum)
    return { open: true, note: `Up to ${money(maximum)} more` };
  return {
    open: false,
    note: row.max - stake < row.minimum ? "At odds limit" : "Bank too low",
  };
}

function OddsCue({ side, label, text }) {
  return (
    <div className="pg-odds-row pg-odds-cue" role="note" data-odds-cue={side}>
      <Lock size={13} aria-hidden="true" />
      <b>{label}</b>
      <span>{text}</span>
    </div>
  );
}

function Board({ state, rows, travelled, tile, passBet, dontBet, oddsTile }) {
  const by = (id) => rows.find((row) => row.id === id);
  const places = rows.filter(isPlaceRow),
    crapless = state.config.mode === "crapless";
  const come = by("come"),
    dontCome = by("dontcome"),
    field = by("field"),
    pass = by("pass"),
    dont = by("dont");
  return (
    <div className={`pg-board ${crapless ? "is-crapless" : ""}`}>
      <div className="pg-board-places">
        {places.map((row) => {
          const n = Number(row.id.split("-")[1]);
          return tile(
            row,
            <>
              {state.point === n && (
                <span className="pg-puck is-on" aria-label="Point">
                  ON
                </span>
              )}
              <strong className={PLACE_WORDS[n] ? "is-word" : ""}>
                {PLACE_WORDS[n] || n}
              </strong>
              {travelled[n] && (
                <small className="pg-travelled">{travelled[n]}</small>
              )}
            </>,
            "pg-tile-place",
          );
        })}
      </div>
      <div className="pg-board-come">
        {dontCome &&
          tile(
            dontCome,
            <span className="pg-tile-name is-small">
              Don’t
              <br />
              Come
            </span>,
            "pg-tile-dontcome",
          )}
        {tile(
          come,
          <span className="pg-tile-name is-red">Come</span>,
          "pg-tile-come",
        )}
      </div>
      {tile(
        field,
        <span className="pg-field">
          <span className="pg-tile-name">Field</span>
          <span className="pg-field-numbers" aria-hidden="true">
            {FIELD_NUMBERS.map((n) => (
              <i key={n} className={n === 2 || n === 12 ? "is-ring" : ""}>
                {n}
              </i>
            ))}
          </span>
        </span>,
        "pg-tile-field",
      )}
      {dont && (
        <div className="pg-board-dont">
          {tile(
            dont,
            <span className="pg-tile-name is-small">Don’t Pass Bar</span>,
            "pg-tile-dont",
          )}
          {dontBet?.point && oddsTile(dontBet, "Don’t Odds")}
        </div>
      )}
      {tile(
        pass,
        <span className="pg-tile-name is-pass">Pass Line</span>,
        "pg-tile-pass",
      )}
      {passBet?.point ? (
        oddsTile(passBet, "Pass Odds")
      ) : (
        <OddsCue
          side="pass"
          label="Pass Odds"
          text={
            passBet
              ? "Open once the point is set"
              : state.point
                ? "Need a Pass Line bet from the come-out"
                : "Bet Pass Line first"
          }
        />
      )}
      {!state.point && (
        <span className="pg-puck is-off pg-board-off" aria-label="No point set">
          OFF
        </span>
      )}
    </div>
  );
}

function MoreBets({ extra, tile }) {
  const groups = ["True odds", "Hardways", "One roll", "Big numbers"];
  return (
    <div className="pg-more">
      {groups.map((group) => {
        const items = extra.filter((row) => row.group === group);
        return (
          <section
            key={group}
            className={`pg-more-group is-${group.split(" ")[0].toLowerCase()}`}
          >
            <h3>{group}</h3>
            {items.length ? (
              <div className="pg-more-grid">
                {items.map((row) => {
                  const n = Number(row.id.split("-")[1]);
                  return tile(
                    row,
                    <>
                      {row.id.startsWith("hard-") && (
                        <span className="pg-tile-dice">
                          <Die value={n / 2} />
                          <Die value={n / 2} />
                        </span>
                      )}
                      <span className="pg-tile-name is-tiny">{row.name}</span>
                    </>,
                    "pg-tile-more",
                  );
                })}
              </div>
            ) : (
              <p>Come odds appear here once a come bet has a point.</p>
            )}
          </section>
        );
      })}
    </div>
  );
}

function PlayPanel({
  state,
  player,
  rows,
  connected,
  busy,
  teach,
  bundle,
  amount,
  selectedRow,
  setSelectedId,
  notice,
  setNotice,
  addChip,
  undo,
  clear,
  setAmount,
  wager,
  lastAmount,
  canReup,
  send,
  onDragTarget,
}) {
  const [view, setView] = useState("board");
  const locked = state.rolling || !connected || busy;
  const context = { player, state, connected };
  const drag = useChipDrag({
    enabled: !locked && amount > 0,
    ghostAmount: amount,
    onDrop(id) {
      const row = rows.find((r) => r.id === id);
      if (row) wager(row);
    },
  });
  const dragTarget = drag.dragging ? drag.hoverId : undefined;
  useEffect(() => {
    onDragTarget(dragTarget);
    return () => onDragTarget(undefined);
  }, [dragTarget, onDragTarget]);
  const {
    stakes,
    counts,
    travelled,
    extras,
    passBet,
    dontBet,
    moreStake,
    oddsCount,
  } = useMemo(() => {
    const stakes = stakeTotals(player.bets),
      counts = {},
      travelled = {};
    for (const b of player.bets) {
      const key = b.type === "odds" ? `odds:${b.parent}` : b.type;
      counts[key] = (counts[key] || 0) + 1;
      if (b.point && (b.type === "come" || b.type === "dontcome"))
        travelled[b.point] =
          `${b.type === "come" ? "C" : "DC"} ${compact(b.amount)}`;
    }
    const passBet = player.bets.find((b) => b.type === "pass"),
      dontBet = player.bets.find((b) => b.type === "dont");
    const onBoard = new Set(
      [passBet, dontBet].filter((b) => b?.point).map((b) => `odds:${b.id}`),
    );
    const extras = rows.filter(
      (row) => !isBoardRow(row) && !onBoard.has(row.id),
    );
    return {
      stakes,
      counts,
      travelled,
      extras,
      passBet,
      dontBet,
      moreStake: sum(extras.map((row) => stakes[row.id] || 0)),
      oddsCount: extras.filter((row) => row.parent).length,
    };
  }, [player.bets, rows]);
  const select = (row) => {
    setSelectedId((current) => (current === row.id ? null : row.id));
    setNotice(null);
  };
  const tile = (row, children, className, extra) => (
    <BetTile
      {...extra}
      key={row.id}
      row={row}
      className={className}
      stake={stakes[row.id] || 0}
      count={counts[row.id] || 0}
      selected={selectedRow?.id === row.id}
      hovered={drag.hoverId === row.id}
      eligible={!betIssue(row, amount, context)}
      dragging={drag.dragging}
      teach={teach}
      onSelect={select}
    >
      {children}
    </BetTile>
  );
  const oddsTile = (parent, label) => {
    const row = rows.find((r) => r.id === `odds:${parent.id}`);
    if (!row) return null;
    const { open, note } = oddsCapacity(row, stakes[row.id] || 0, player);
    const detail =
      parent.type === "pass" && open
        ? `Min ${money(row.minimum)} · ${money(row.quantum)} steps · ${note}`
        : note;
    return tile(
      row,
      <span className="pg-odds-text">
        <b>
          {label} · {parent.point}
        </b>
        <small>{detail}</small>
      </span>,
      "pg-odds-row pg-tile-odds",
      {
        note: `${detail}. Pays ${row.payout}. Total odds limit ${money(row.max)}`,
        disabled: !open || state.rolling || !connected,
      },
    );
  };
  const liveNotice = !connected
    ? { tone: "error", text: "Reconnecting. Bets are paused." }
    : state.rolling
      ? { tone: "lock", text: "Dice are out. Bets are locked." }
      : notice;
  const showQuick = !locked && !!selectedRow?.available && !liveNotice;
  const fallback = selectedRow
    ? `${selectedRow.name} · min ${money(selectedRow.minimum)}${
        selectedRow.quantum > 100
          ? ` · ${money(selectedRow.quantum)} steps`
          : ""
      }${
        teach
          ? ` · pays ${selectedRow.payout.split(" · ")[0]} · ${(selectedRow.prob * 100).toFixed(1)}% win · ${selectedRow.edge.toFixed(2)}% edge`
          : ""
      }`
    : amount
      ? "Drag your chips to a bet, or tap a bet."
      : "Tap chips to build a bet.";
  const quick = [
    lastAmount > 0 &&
      lastAmount <= player.bank && {
        label: `Repeat ${money(lastAmount)}`,
        value: () => setAmount(lastAmount),
      },
    state.config.minBet <= player.bank &&
      state.config.minBet % 100 === 0 &&
      lastAmount !== state.config.minBet && {
        label: `Min ${money(state.config.minBet)}`,
        value: () => setAmount(state.config.minBet),
      },
  ].filter(Boolean);
  return (
    <div className="pg-play">
      <div className="pg-rack">
        {canReup ? (
          <div className="pg-reup is-rack">
            <span>Below the table minimum.</span>
            <button
              type="button"
              disabled={locked}
              onClick={() => send({ type: "reup" })}
            >
              <RefreshCw size={16} /> Re-up to{" "}
              {money(state.config.startingBank)}
            </button>
          </div>
        ) : (
          <>
            <Tray
              amount={amount}
              bank={player.bank}
              locked={locked}
              onAdd={addChip}
            />
            <BundleBar
              chips={bundle}
              amount={amount}
              locked={locked}
              drag={drag}
              placeLabel={
                selectedRow && amount > 0
                  ? `Place ${money(amount)}`
                  : selectedRow
                    ? "Add chips"
                    : "Choose a bet"
              }
              placeDetail={selectedRow?.name}
              canPlace={!locked && !!selectedRow && amount > 0}
              onPlace={() => selectedRow && wager(selectedRow)}
              onUndo={undo}
              onClear={clear}
              onHint={() =>
                setNotice({
                  tone: "hint",
                  text: "Drag this onto a bet, or tap a bet and press Place.",
                })
              }
              quick={quick}
            />
          </>
        )}
        {!canReup && (
          <div className="pg-feedback">
            {showQuick ? (
              <QuickBets
                row={selectedRow}
                player={player}
                onBet={wager}
                detail={
                  teach
                    ? `Min ${money(selectedRow.minimum)} · pays ${selectedRow.payout.split(" · ")[0]} · ${(selectedRow.prob * 100).toFixed(1)}% win · ${selectedRow.edge.toFixed(2)}% edge`
                    : undefined
                }
              />
            ) : (
              <Notice
                notice={liveNotice}
                fallback={fallback}
                onBet={wager}
                locked={locked}
              />
            )}
          </div>
        )}
      </div>
      <div className="pg-board-switch" role="group" aria-label="Betting layout">
        <button
          type="button"
          aria-pressed={view === "board"}
          onClick={() => setView("board")}
        >
          Table
        </button>
        <button
          type="button"
          aria-pressed={view === "more"}
          onClick={() => setView("more")}
        >
          More bets
          {moreStake > 0 && <b>{compact(moreStake)}</b>}
          {oddsCount > 0 && <em>Odds</em>}
        </button>
      </div>
      <div className={`pg-felt ${locked ? "is-locked" : ""}`}>
        {view === "board" ? (
          <Board
            state={state}
            rows={rows}
            travelled={travelled}
            tile={tile}
            passBet={passBet}
            dontBet={dontBet}
            oddsTile={oddsTile}
          />
        ) : (
          <MoreBets extra={extras} tile={tile} />
        )}
      </div>
      {drag.ghostNode}
    </div>
  );
}

function betStatus(state, player, bet) {
  const parent = player.bets.find((b) => b.id === bet.parent);
  if (bet.point && (bet.type === "pass" || bet.type === "come"))
    return { text: "Locked until its point resolves", locked: true };
  if (
    !state.point &&
    (bet.type.startsWith("place") ||
      bet.type.startsWith("hard") ||
      (bet.type === "odds" && parent?.type === "come"))
  )
    return { text: "Off this come-out" };
  return { text: "Working" };
}

function BetsPanel({
  state,
  player,
  rows,
  connected,
  teach,
  send,
  onPlay,
  canReup,
}) {
  const locked = state.rolling || !connected;
  const context = { player, state, connected };
  const total = sum(player.bets.map((b) => b.amount)),
    session = net(player);
  return (
    <div className="pg-bets">
      <dl className="pg-bets-summary">
        <div>
          <dt>On the table</dt>
          <dd>{money(total)}</dd>
        </div>
        <div>
          <dt>Bank</dt>
          <dd>{money(player.bank)}</dd>
        </div>
        <div>
          <dt>Session</dt>
          <dd className={session > 0 ? "is-up" : session < 0 ? "is-down" : ""}>
            {session ? signed(session) : "$0"}
          </dd>
        </div>
      </dl>
      {canReup && (
        <div className="pg-reup">
          <span>Below the table minimum.</span>
          <button
            type="button"
            disabled={locked}
            onClick={() => send({ type: "reup" })}
          >
            <RefreshCw size={16} /> Re-up to {money(state.config.startingBank)}
          </button>
        </div>
      )}
      {player.bets.length ? (
        <ul className="pg-bets-list">
          {player.bets.map((b) => {
            const meta = describeBet(state, player, b),
              status = betStatus(state, player, b),
              name = meta?.name || b.type,
              isLine = LINE_TYPES.includes(b.type);
            // A line bet with a point grows through its odds row, everything else through itself.
            const addRow = rows.find((row) =>
              isLine && b.point
                ? row.id === `odds:${b.id}`
                : b.type === "odds"
                  ? row.id === `odds:${b.parent}`
                  : row.id === b.type,
            );
            const addIssue =
              addRow && betIssue(addRow, addRow.minimum, context);
            const hasOdds = player.bets.some((x) => x.parent === b.id);
            return (
              <li key={b.id}>
                <Chip value={chipFor(b.amount)} />
                <div className="pg-bet-text">
                  <b>
                    {name}
                    {b.point && b.type !== "odds" ? ` · ${b.point}` : ""}
                  </b>
                  <small>
                    {status.locked && <Lock size={11} aria-hidden="true" />}
                    {status.text}
                    {hasOdds && !status.locked ? " · odds come down too" : ""}
                    {teach && meta
                      ? ` · pays ${meta.payout.split(" · ")[0]} · ${(meta.prob * 100).toFixed(1)}% win`
                      : ""}
                  </small>
                </div>
                <strong>{money(b.amount)}</strong>
                {addRow && (
                  <button
                    type="button"
                    className="pg-bet-add"
                    disabled={!!addIssue}
                    aria-label={`Add ${money(addRow.minimum)} ${addRow.parent && b.type !== "odds" ? "odds " : ""}to ${name}`}
                    onClick={() =>
                      send({
                        type: "bet",
                        betId: addRow.id,
                        amount: addRow.minimum,
                      })
                    }
                  >
                    <Plus size={13} />
                    {addRow.parent && b.type !== "odds" ? "Odds " : ""}
                    {money(addRow.minimum)}
                  </button>
                )}
                <button
                  type="button"
                  className="pg-icon"
                  aria-label={
                    status.locked ? `${name} is locked` : `Take down ${name}`
                  }
                  disabled={locked || status.locked}
                  onClick={() => send({ type: "remove", betId: b.id })}
                >
                  {status.locked ? <Lock size={16} /> : <X size={18} />}
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="pg-empty">
          <p>No bets on the table.</p>
          <button type="button" className="pg-quick" onClick={onPlay}>
            Go to the board
          </button>
        </div>
      )}
    </div>
  );
}

function RollOutcome({
  state,
  player,
  shooterName,
  isShooter,
  settled,
  expanded,
  onToggle,
}) {
  const roll = state.lastRoll;
  if (state.rolling)
    return (
      <div className="pg-strip is-rolling" role="status">
        <span className="pg-strip-icon">
          <Dices size={24} />
        </span>
        <span className="pg-strip-text">
          <b>Dice are rolling</b>
          <small>
            Bets locked · {isShooter ? "your throw" : `${shooterName} threw`}
          </small>
        </span>
      </div>
    );
  if (!roll)
    return (
      <div className="pg-strip" role="status">
        <span className="pg-strip-icon">
          <Dices size={24} />
        </span>
        <span className="pg-strip-text">
          <b>Come-out roll</b>
          <small>
            {isShooter ? "You have the dice" : `${shooterName} has the dice`}
          </small>
        </span>
      </div>
    );
  const event = roll.events.find((e) => e.playerId === player.id);
  const delta = event?.delta || 0;
  const outcomes = event?.bets || [];
  const hadAction = settled.some((item) => item.gone) || outcomes.length > 0;
  const realPush =
    outcomes.length > 0 && outcomes.every((item) => item.result === "push");
  const tone =
    delta > 0
      ? "win"
      : delta < 0
        ? "loss"
        : realPush
          ? "push"
          : hadAction
            ? "even"
            : "none";
  return (
    <button
      type="button"
      key={roll.id}
      className={`pg-strip is-result is-${roll.kind}`}
      aria-expanded={expanded}
      aria-label={`Last roll ${roll.total}. ${roll.message} ${
        delta ? `Your change ${signed(delta)}.` : ""
      } Show details.`}
      onClick={onToggle}
    >
      <span className="pg-strip-dice">
        <Die value={roll.dice[0]} />
        <Die value={roll.dice[1]} />
        <b>{roll.total}</b>
      </span>
      <span className="pg-strip-text" aria-live="polite">
        <b>{roll.message}</b>
        <small>
          {isShooter ? "You have the dice" : `${shooterName} has the dice`}
        </small>
      </span>
      {tone !== "none" && (
        <span className={`pg-delta is-${tone}`}>
          {tone === "win" && <ArrowUp size={13} aria-hidden="true" />}
          {tone === "loss" && <ArrowDown size={13} aria-hidden="true" />}
          {tone === "push" || tone === "even" ? (
            <>
              <Equal size={13} aria-hidden="true" />{" "}
              {tone === "push" ? "Push" : "Even"}
            </>
          ) : (
            money(Math.abs(delta))
          )}
        </span>
      )}
      <ChevronDown
        size={16}
        className={`pg-chevron ${expanded ? "is-open" : ""}`}
        aria-hidden="true"
      />
    </button>
  );
}

function RollDetail({ state, player, settled, outcomes }) {
  const roll = state.lastRoll;
  const others = roll.events.filter((e) => e.playerId !== player.id);
  const delta = roll.events.find((e) => e.playerId === player.id)?.delta || 0;
  return (
    <div className="pg-detail">
      <div className="pg-detail-head">
        <Die value={roll.dice[0]} />
        <Die value={roll.dice[1]} />
        <div>
          <b>{roll.total}</b>
          <span>{roll.message}</span>
        </div>
      </div>
      <dl>
        <div>
          <dt>Your change</dt>
          <dd className={delta > 0 ? "is-up" : delta < 0 ? "is-down" : ""}>
            {delta ? signed(delta) : "$0"}
          </dd>
        </div>
        <div>
          <dt>Session</dt>
          <dd>{signed(net(player))}</dd>
        </div>
      </dl>
      {(outcomes.length > 0 || settled.length > 0) && (
        <>
          <h3>Your bets</h3>
          <ul>
            {outcomes.length
              ? outcomes.map((o, i) => (
                  <li key={i}>
                    <span>{o.label || o.name}</span>
                    <b>
                      {o.result}
                      {o.delta ? ` ${signed(o.delta)}` : ""}
                    </b>
                  </li>
                ))
              : settled.map((item) => (
                  <li key={item.id}>
                    <span>
                      {item.name} · {money(item.amount)}
                    </span>
                    <b>{item.note}</b>
                  </li>
                ))}
          </ul>
        </>
      )}
      {others.length > 0 && (
        <>
          <h3>Around the table</h3>
          <ul>
            {others.map((e) => (
              <li key={e.playerId}>
                <span>{e.name}</span>
                <b className={e.delta > 0 ? "is-up" : "is-down"}>
                  {signed(e.delta)}
                </b>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function SettingsSheet({ open, onClose, children }) {
  const dialog = useRef(null);
  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    if (open && !el.open) el.showModal?.();
    if (!open && el.open) el.close();
  }, [open]);
  return (
    <dialog
      ref={dialog}
      className="pg-sheet"
      aria-label="Settings"
      onClose={onClose}
      onClick={(event) => event.target === dialog.current && onClose()}
    >
      <div className="pg-sheet-body">
        <header>
          <h2>Settings</h2>
          <button
            type="button"
            className="pg-icon"
            aria-label="Close settings"
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </header>
        <div className="pg-sheet-content">{open && children}</div>
      </div>
    </dialog>
  );
}

// The chips start on the actual DOM betting targets, then move into the bank.
// RAF changes only the overlay transforms; it never drives the game ledger.
function MobilePayout({ presentation, onLand }) {
  const nodes = useRef(new Map());
  const layer = useRef(null);
  useLayoutEffect(() => {
    const shell = layer.current?.closest(".pg-shell");
    if (!shell) return;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    let frame,
      started,
      disposed = false;
    const landed = new Set();
    const items = presentation.entries.map((entry, index) => ({
      entry,
      index,
      element: nodes.current.get(entry.id),
    }));
    const measure = () => {
      const targets = [
        ...shell.querySelectorAll("[data-bet-id], [data-odds-cue]"),
      ];
      const targetId = (element) =>
        element.dataset.betId || `odds-cue:${element.dataset.oddsCue}`;
      const bank = shell
        .querySelector("[data-bank-target]")
        ?.getBoundingClientRect();
      const felt = shell.querySelector(".pg-felt")?.getBoundingClientRect();
      const nav = shell.querySelector(".pg-nav")?.getBoundingClientRect();
      const header = shell.querySelector(".pg-header")?.getBoundingClientRect();
      const groups = new Map();
      for (const item of items) {
        const { entry, element } = item;
        const target = entry.anchors
          .map((id) =>
            targets.find(
              (el) =>
                targetId(el) === id && el.getBoundingClientRect().height > 0,
            ),
          )
          .find(Boolean);
        const rect = target?.getBoundingClientRect() || felt;
        if (!rect || !bank || !element) continue;
        const key = target ? targetId(target) : "other";
        const sibling = groups.get(key) || 0;
        groups.set(key, sibling + 1);
        // Keep complete labels inside even the narrowest supported phone.
        item.x = Math.max(
          88,
          Math.min(
            innerWidth - 88,
            rect.x + rect.width / 2 + (sibling % 2 ? 34 : -14),
          ),
        );
        item.y = Math.max(
          (header?.bottom || 54) + 50,
          Math.min(
            (nav?.top || innerHeight - 70) - 34,
            rect.y + rect.height / 2 + sibling * 48,
          ),
        );
        item.toX = bank.x + bank.width / 2;
        item.toY = bank.y + bank.height / 2;
        element.dataset.anchor = target ? targetId(target) : "other-bets";
        element.dataset.phase = "on-board";
        element.style.opacity = "1";
      }
    };
    measure();
    const tick = (now) => {
      if (disposed) return;
      started ??= now;
      const elapsed = now - started;
      for (const item of items) {
        const { entry, index, element, x, y, toX, toY } = item;
        if (!element || landed.has(entry.id)) continue;
        const delay = MOBILE_PAYOUT_HOLD_MS + index * MOBILE_PAYOUT_STAGGER_MS;
        const progress = reduced
          ? elapsed >= delay
            ? 1
            : 0
          : Math.max(
              0,
              Math.min(1, (elapsed - delay) / MOBILE_PAYOUT_FLIGHT_MS),
            );
        const ease = progress * progress * (3 - 2 * progress);
        const dx = Number.isFinite(x) ? x + (toX - x) * ease : innerWidth / 2;
        const dy = Number.isFinite(y)
          ? y + (toY - y) * ease - Math.sin(progress * Math.PI) * 42
          : innerHeight / 2;
        element.style.transform = `translate3d(${dx}px,${dy}px,0) translate(-50%,-50%) scale(${1 - ease * 0.67})`;
        element.dataset.phase = progress ? "flying" : "on-board";
        if (progress >= 1) {
          element.dataset.phase = "landed";
          element.style.opacity = "0";
          landed.add(entry.id);
          onLand(entry.id);
        }
      }
      if (landed.size < items.length) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    window.addEventListener("resize", measure);
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", measure);
    };
  }, [presentation.id, onLand]);
  return (
    <div
      ref={layer}
      className="pg-payout-layer"
      data-payout-roll={presentation.id}
    >
      <span className="pg-sr-only" role="status">
        {presentation.entries
          .map(
            (entry) =>
              `${entry.label}: ${entry.profit ? `${money(entry.profit)} won` : "Push"}${entry.returnedStake ? `, ${money(entry.returnedStake)} stake returned` : ", stake stays on the table"}.`,
          )
          .join(" ")}
      </span>
      {presentation.entries.map((entry) => (
        <div
          key={entry.id}
          ref={(el) => {
            if (el) nodes.current.set(entry.id, el);
            else nodes.current.delete(entry.id);
          }}
          className="pg-payout"
          data-payout-bet={entry.betId}
        >
          <div className="pg-payout-chip">
            <Chip value={chipFor(entry.total)} />
            <b>{money(entry.total)}</b>
          </div>
          <div className="pg-payout-label">
            <strong>{entry.label}</strong>
            <span>{entry.profit ? `+${money(entry.profit)} won` : "Push"}</span>
            <small>
              {entry.returnedStake
                ? `${money(entry.returnedStake)} stake returned`
                : "Stake stays on table"}
            </small>
          </div>
        </div>
      ))}
    </div>
  );
}

export default function PhoneGame({
  state,
  player,
  isAdmin,
  send,
  connected,
  rollArea,
  settingsArea,
  serverError,
}) {
  const images = useChipThumbnails();
  const [tab, setTab] = useState("play"),
    [settingsOpen, setSettingsOpen] = useState(false),
    [detailOpen, setDetailOpen] = useState(false),
    [selectedId, setSelectedId] = useState(null),
    [notice, setNotice] = useState(null),
    [lastAmount, setLastAmount] = useState(0),
    [pendingWager, setPendingWager] = useState(null),
    [dragTarget, setDragTarget] = useState(undefined),
    [bundle, setBundle] = useState(() =>
      state.config.minBet <= player.bank
        ? chipsForAmount(state.config.minBet)
        : [],
    );
  const [presentation, setPresentation] = useState(null);
  const previousSnapshot = useRef(null);
  const reconnectBaseline = useRef(null);
  const amount = sum(bundle);
  const rows = useMemo(() => catalogue(state, player), [state, player]);
  const selectedRow = rows.find((row) => row.id === selectedId) || null;
  const stake = sum(player.bets.map((b) => b.amount));
  const isShooter = state.shooterId === player.id,
    canThrow = (isShooter || isAdmin) && !state.rolling && connected,
    shooterName =
      state.players.find((p) => p.id === state.shooterId)?.name || "The host",
    canReup = equity(player) < state.config.minBet && !player.bets.length;

  // A continuous connection and a new, recent server result are required.
  // First snapshots and reconnects establish a baseline without replaying money.
  useLayoutEffect(() => {
    if (!connected) {
      previousSnapshot.current = null;
      reconnectBaseline.current = { state, snapshotAt: state.snapshotAt };
      setPresentation(null);
      return;
    }
    if (reconnectBaseline.current) {
      const baseline = reconnectBaseline.current;
      // Transport can reconnect before its first room snapshot arrives.
      if (
        state === baseline.state ||
        (Number.isFinite(baseline.snapshotAt) &&
          state.snapshotAt === baseline.snapshotAt)
      )
        return;
      reconnectBaseline.current = null;
      previousSnapshot.current = state;
      return;
    }
    const previous = previousSnapshot.current;
    previousSnapshot.current = state;
    if (
      state.rolling &&
      (!previous?.rolling || state.throw?.id !== previous.throw?.id)
    ) {
      setPresentation(null);
      if (rollArea) setTab("dice");
    }
    const fresh = freshMobileSettlement(previous, state, player.id);
    if (fresh) setPresentation({ ...fresh, active: false, landed: [] });
  }, [state, connected, player.id, !!rollArea]);
  useEffect(() => {
    if (!presentation || presentation.active) return;
    const id = presentation.id;
    const timer = setTimeout(() => {
      setTab("play");
      setDetailOpen(false);
      setPresentation((current) =>
        current?.id === id && current.entries.length
          ? { ...current, active: true }
          : null,
      );
    }, MOBILE_DICE_HOLD_MS);
    return () => clearTimeout(timer);
  }, [presentation?.id, presentation?.active]);
  const landPayout = useCallback(
    (id) =>
      setPresentation((current) => {
        if (!current || current.landed.includes(id)) return current;
        const landed = [...current.landed, id];
        return landed.length === current.entries.length
          ? null
          : { ...current, landed };
      }),
    [],
  );
  const pendingCredit =
    presentation?.entries.reduce(
      (total, entry) =>
        total + (presentation.landed.includes(entry.id) ? 0 : entry.total),
      0,
    ) || 0;
  const displayedBank = Math.max(0, player.bank - pendingCredit);

  // Bets are frozen while dice fly, so this is exactly what the roll acted on.
  const thrown = useRef(null);
  if (state.rolling && thrown.current?.id !== (state.throw?.id || "rolling"))
    thrown.current = {
      id: state.throw?.id || "rolling",
      bets: player.bets.map((b) => ({
        ...b,
        name: describeBet(state, player, b)?.name || b.type,
      })),
    };
  const rollId = state.lastRoll?.id;
  const settled = useMemo(() => {
    const roll = state.lastRoll,
      before = thrown.current;
    if (!roll || !before || before.id !== (roll.throwId || "rolling"))
      return [];
    return before.bets.map((b) => {
      const now = player.bets.find((x) => x.id === b.id);
      return {
        id: b.id,
        name: `${b.name}${b.point && b.type !== "odds" ? ` · ${b.point}` : ""}`,
        amount: b.amount,
        gone: !now,
        note: !now
          ? "Settled"
          : now.point !== b.point
            ? `Moved to ${now.point}`
            : "Still up",
      };
    });
    // Recomputed per roll only: later take-downs are not outcomes of this roll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rollId]);
  const myEvent = state.lastRoll?.events.find((e) => e.playerId === player.id);
  const outcomes = myEvent?.bets || myEvent?.outcomes || [];

  // Lives here, not in PlayPanel, so leaving the Play tab clears the TV while a
  // cash-out or session end (which the server clears itself) sends nothing.
  const staged =
    tab === "play" && !canReup && !pendingCredit && amount <= player.bank
      ? amount
      : 0;
  useBetPreview({
    send,
    echo: player.betPreview,
    canSend: connected && !state.rolling && state.status === "playing",
    held: !!pendingWager,
    amount: staged,
    betId: dragTarget !== undefined ? dragTarget : selectedRow?.id,
  });

  useEffect(() => {
    if (!state.rolling) return;
    setDetailOpen(false);
    setNotice(null);
  }, [state.rolling]);
  useEffect(() => {
    if (notice?.tone !== "ok") return undefined;
    const timer = setTimeout(() => setNotice(null), 2600);
    return () => clearTimeout(timer);
  }, [notice]);

  const addChip = (value) => {
    if (pendingWager) return;
    if (amount + value > player.bank) {
      setNotice({
        tone: "error",
        text: `You have ${money(player.bank)} in the bank.`,
      });
      return;
    }
    setBundle((chips) => [...chips, value]);
    setNotice(null);
  };
  const setAmount = (value) => {
    setBundle(chipsForAmount(value));
    setNotice(null);
  };
  const wagerTotal = (row, bets) =>
    bets
      .filter((b) =>
        row.parent
          ? b.type === "odds" && b.parent === row.parent
          : b.type === row.id,
      )
      .reduce((n, b) => n + b.amount, 0);
  useEffect(() => {
    if (!pendingWager) return;
    const current = wagerTotal(pendingWager.row, player.bets);
    if (current >= pendingWager.before + pendingWager.amount) {
      setBundle([]);
      setLastAmount(pendingWager.amount);
      setSelectedId(null);
      setNotice({
        tone: "ok",
        text: `Placed ${money(pendingWager.amount)} on ${pendingWager.row.name}.`,
      });
      setPendingWager(null);
      return;
    }
    const timeout = setTimeout(
      () => {
        setPendingWager(null);
        setNotice({
          tone: "error",
          text: "Bet was not confirmed. Your chip bundle is still here.",
        });
      },
      Math.max(0, pendingWager.deadline - Date.now()),
    );
    return () => clearTimeout(timeout);
  }, [pendingWager, player.bets]);
  useEffect(() => {
    if (serverError && pendingWager) {
      setPendingWager(null);
      setNotice({ tone: "error", text: serverError });
    }
  }, [serverError]);
  // `exact` is a legal amount the player chose by name; without it the bundle is
  // the bet. Both are revalidated against the live bank and row before sending.
  function wager(row, exact) {
    if (pendingWager) return;
    const chosen = exact ?? amount;
    const issue = betIssue(row, chosen, { player, state, connected });
    if (issue) {
      setSelectedId(row.id);
      setNotice({
        tone: "error",
        text: issue.text,
        row: issue.lower != null || issue.upper != null ? row : null,
        lower: issue.lower,
        upper: issue.upper,
      });
      return;
    }
    setPendingWager({
      row,
      amount: chosen,
      before: wagerTotal(row, player.bets),
      deadline: Date.now() + 7000,
    });
    setNotice({ tone: "hint", text: "Placing bet…" });
    Promise.resolve(send({ type: "bet", betId: row.id, amount: chosen }))
      .then((result) => {
        if (result === false) {
          setPendingWager(null);
          setNotice({
            tone: "error",
            text: "Bet not sent. Your chip bundle is still here.",
          });
        }
      })
      .catch((error) => {
        setPendingWager(null);
        setNotice({
          tone: "error",
          text:
            error?.message || "Bet not sent. Your chip bundle is still here.",
        });
      });
  }

  const tabs = [
    { id: "play", label: "Play", icon: CircleDot },
    {
      id: "bets",
      label: "Bets",
      icon: Coins,
      badge: player.bets.length || null,
    },
    ...(rollArea
      ? [
          {
            id: "dice",
            label: canThrow ? "Roll" : "Dice",
            icon: Dices,
            ready: canThrow,
          },
        ]
      : []),
    { id: "learn", label: "Learn", icon: BookOpen },
  ];
  return (
    <ChipImages.Provider value={images}>
      <div className="pg-shell">
        <header className="pg-header">
          <span
            className="pg-avatar"
            style={{ "--player": player.color }}
            aria-hidden="true"
          >
            {player.name[0]?.toUpperCase()}
          </span>
          <div className="pg-identity">
            <b>{player.name}</b>
            <small>
              <i
                className={connected ? "is-live" : "is-down"}
                aria-hidden="true"
              />
              {connected
                ? `${isAdmin ? "Host · " : ""}${state.code}`
                : "Reconnecting"}
            </small>
          </div>
          <dl className="pg-wallet">
            <div
              data-bank-target
              className={pendingCredit ? "is-awaiting-payout" : ""}
            >
              <dt>Bank</dt>
              <dd data-bank-value={displayedBank}>{compact(displayedBank)}</dd>
            </div>
            <div>
              <dt>Stake</dt>
              <dd>{compact(stake)}</dd>
            </div>
          </dl>
          <span
            className={`pg-puck ${state.point ? "is-on" : "is-off"}`}
            aria-label={
              state.point ? `Point is ${state.point}` : "No point set"
            }
            role="img"
          >
            {state.point || "OFF"}
          </span>
          {settingsArea && (
            <button
              type="button"
              className="pg-icon"
              aria-label="Open settings"
              aria-haspopup="dialog"
              onClick={() => setSettingsOpen(true)}
            >
              <Settings size={20} />
            </button>
          )}
        </header>
        <div className="pg-outcome">
          <RollOutcome
            state={state}
            player={player}
            shooterName={shooterName}
            isShooter={isShooter}
            settled={settled}
            expanded={detailOpen}
            onToggle={() => setDetailOpen((open) => !open)}
          />
          {detailOpen && state.lastRoll && !state.rolling && (
            <RollDetail
              state={state}
              player={player}
              settled={settled}
              outcomes={outcomes}
            />
          )}
        </div>
        {detailOpen && (
          <button
            type="button"
            className="pg-scrim"
            aria-label="Close roll details"
            onClick={() => setDetailOpen(false)}
          />
        )}
        <main
          className="pg-main"
          role="tabpanel"
          id={`pg-panel-${tab}`}
          aria-labelledby={`pg-tab-${tab}`}
        >
          {tab === "play" && (
            <PlayPanel
              state={state}
              player={player}
              rows={rows}
              connected={connected}
              teach={state.config.teach}
              busy={!!pendingWager || pendingCredit > 0}
              bundle={bundle}
              amount={amount}
              selectedRow={selectedRow}
              setSelectedId={setSelectedId}
              notice={notice}
              setNotice={setNotice}
              addChip={addChip}
              undo={() => {
                setBundle((chips) => chips.slice(0, -1));
                setNotice(null);
              }}
              clear={() => {
                setBundle([]);
                setNotice(null);
              }}
              setAmount={setAmount}
              wager={wager}
              lastAmount={lastAmount}
              canReup={canReup}
              send={send}
              onDragTarget={setDragTarget}
            />
          )}
          {tab === "bets" && (
            <BetsPanel
              state={state}
              player={player}
              rows={rows}
              connected={connected}
              teach={state.config.teach}
              send={send}
              canReup={canReup}
              onPlay={() => setTab("play")}
            />
          )}
          {tab === "dice" && <div className="pg-dice">{rollArea}</div>}
          {tab === "learn" && (
            <Suspense
              fallback={
                <div className="pg-empty" role="status">
                  Loading lessons…
                </div>
              }
            >
              <LearnCenter state={state} player={player} />
            </Suspense>
          )}
        </main>
        <nav className="pg-nav" role="tablist" aria-label="Game sections">
          {tabs.map(({ id, label, icon: Icon, badge, ready }) => (
            <button
              type="button"
              key={id}
              role="tab"
              id={`pg-tab-${id}`}
              aria-selected={tab === id}
              aria-controls={`pg-panel-${id}`}
              className={ready ? "is-ready" : ""}
              onClick={() => setTab(id)}
            >
              <span className="pg-nav-icon">
                <Icon size={21} aria-hidden="true" />
                {badge && <b>{badge}</b>}
              </span>
              {label}
            </button>
          ))}
        </nav>
        {presentation?.active && (
          <MobilePayout presentation={presentation} onLand={landPayout} />
        )}
        {settingsArea && (
          <SettingsSheet
            open={settingsOpen}
            onClose={() => setSettingsOpen(false)}
          >
            {settingsArea}
          </SettingsSheet>
        )}
      </div>
    </ChipImages.Provider>
  );
}
