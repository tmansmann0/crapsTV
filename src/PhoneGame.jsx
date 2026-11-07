import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ArrowDown,
  ArrowUp,
  BookOpen,
  Check,
  ChevronDown,
  CircleDot,
  Coins,
  Dices,
  Equal,
  Lock,
  Plus,
  RefreshCw,
  RotateCcw,
  Settings,
  Undo2,
  X,
} from "lucide-react";
import { catalogue, describeBet, equity, money, net } from "./game.js";
import "./phone-game.css";

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
const PRACTICE_BANK = 10000;
const PRACTICE_MIN = 500;

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
  const [images, setImages] = useState(null);
  useEffect(() => {
    let live = true;
    // Three.js stays out of the first paint; piles show CSS chips until this lands.
    import("./chip-rendering.js")
      .then(({ renderChipThumbnails }) =>
        renderChipThumbnails(THUMBNAILS, { size: 160 }),
      )
      .then((result) => live && setImages(result))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  return images;
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
// changes the amount; `fix` is only offered to the player as a button.
function betIssue(row, amount, { player, state, connected }) {
  if (!connected) return { text: "Reconnecting. Bets are paused." };
  if (state.rolling) return { text: "Dice are out. Bets are locked." };
  if (!row.available) return { text: `${row.name}: ${unavailableLabel(row)}.` };
  if (amount <= 0) return { text: "Tap chips to build a bet first." };
  const existing = row.parent
    ? player.bets.find((b) => b.parent === row.parent)?.amount || 0
    : 0;
  const room = Math.min(
    player.bank,
    row.parent ? row.max - existing : player.bank,
  );
  const valid =
    amount >= row.minimum && amount % row.quantum === 0 && amount <= room;
  if (valid) return null;
  const q = row.quantum,
    up = Math.max(row.minimum, Math.ceil(amount / q) * q),
    down = Math.floor(amount / q) * q,
    largest = Math.floor(room / q) * q;
  const fix =
    up <= room
      ? up
      : down >= row.minimum && down <= room
        ? down
        : largest >= row.minimum
          ? largest
          : null;
  let text;
  if (amount > player.bank)
    text = `You have ${money(player.bank)} in the bank.`;
  else if (row.parent && amount > room)
    text = room
      ? `Odds limit: ${money(room)} more on this bet.`
      : "These odds are at the 5× limit.";
  else if (amount < row.minimum)
    text = `${row.name} minimum is ${money(row.minimum)}.`;
  else text = `${row.name} goes up in ${money(q)} steps.`;
  return { text, fix };
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
      aria-label={`${row.name}${
        row.available ? "" : `, ${unavailableLabel(row)}`
      }${stake ? `, your stake ${money(stake)}` : ""}`}
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

function Notice({ notice, fallback, onFix }) {
  const tone = notice?.tone || "hint";
  return (
    <div
      className={`pg-notice is-${tone}`}
      role={tone === "error" ? "alert" : "status"}
    >
      <span>{notice?.text || fallback}</span>
      {notice?.fix != null && (
        <button
          type="button"
          className="pg-notice-fix"
          onClick={() => onFix(notice.fix)}
        >
          Use {money(notice.fix)}
        </button>
      )}
    </div>
  );
}

function Board({ state, rows, travelled, tile }) {
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
      {dont &&
        tile(
          dont,
          <span className="pg-tile-name is-small">Don’t Pass Bar</span>,
          "pg-tile-dont",
        )}
      {tile(
        pass,
        <span className="pg-tile-name is-pass">Pass Line</span>,
        "pg-tile-pass",
      )}
      {!state.point && (
        <span className="pg-puck is-off pg-board-off" aria-label="No point set">
          OFF
        </span>
      )}
    </div>
  );
}

function MoreBets({ rows, tile }) {
  const extra = rows.filter((row) => !isBoardRow(row));
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
              <p>Available once a line bet has a point.</p>
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
  const { stakes, counts, travelled, moreStake, oddsCount } = useMemo(() => {
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
    const extras = rows.filter((row) => !isBoardRow(row));
    return {
      stakes,
      counts,
      travelled,
      moreStake: sum(extras.map((row) => stakes[row.id] || 0)),
      oddsCount: extras.filter((row) => row.parent).length,
    };
  }, [player.bets, rows]);
  const select = (row) => {
    setSelectedId((current) => (current === row.id ? null : row.id));
    setNotice(null);
  };
  const tile = (row, children, className) => (
    <BetTile
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
          <Notice
            notice={
              !connected
                ? { tone: "error", text: "Reconnecting. Bets are paused." }
                : state.rolling
                  ? { tone: "lock", text: "Dice are out. Bets are locked." }
                  : notice
            }
            fallback={fallback}
            onFix={setAmount}
          />
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
          <Board state={state} rows={rows} travelled={travelled} tile={tile} />
        ) : (
          <MoreBets rows={rows} tile={tile} />
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

const STEPS = [
  { title: "Pick a chip", hint: "Tap any chip in the tray." },
  { title: "Bundle", hint: "Tap more until you hold $10 or more." },
  {
    title: "Place",
    hint: "Drag the bundle to Pass or Field, or tap one then Place.",
  },
  { title: "Swipe", hint: "Swipe up on the pad to throw." },
];

// Local fake chips. This component is never given `send`.
function Practice({ mode, teach }) {
  const [bank, setBank] = useState(PRACTICE_BANK),
    [chips, setChips] = useState([]),
    [bets, setBets] = useState({}),
    [selected, setSelected] = useState(null),
    [step, setStep] = useState(0),
    [result, setResult] = useState(null),
    [note, setNote] = useState(null);
  const amount = sum(chips),
    crapless = mode === "crapless";
  const rows = [
    { id: "practice-field", name: "Field", payout: "1:1", available: true },
    { id: "practice-pass", name: "Pass line", payout: "1:1", available: true },
  ];
  const lay = (row) => {
    if (amount < PRACTICE_MIN) {
      setNote(`Practice minimum is ${money(PRACTICE_MIN)}.`);
      return;
    }
    setBets((b) => ({ ...b, [row.id]: (b[row.id] || 0) + amount }));
    setBank((n) => n - amount);
    setChips([]);
    setSelected(null);
    setNote(null);
    setStep(3);
  };
  const drag = useChipDrag({
    enabled: step >= 2 && step < 4 && amount > 0,
    ghostAmount: amount,
    onDrop(id) {
      const row = rows.find((r) => r.id === id);
      if (row) lay(row);
    },
  });
  const add = (value) => {
    if (amount + value > bank) return;
    const next = amount + value;
    setChips((c) => [...c, value]);
    setNote(null);
    setStep((s) => (next >= 1000 ? Math.max(s, 2) : Math.max(s, 1)));
  };
  const swipe = useRef(null);
  const throwDice = () => {
    if (!sum(Object.values(bets))) return;
    const dice = [1, 2].map(() => 1 + Math.floor(Math.random() * 6)),
      total = dice[0] + dice[1];
    let change = 0,
      returned = 0;
    const pass = bets["practice-pass"] || 0,
      field = bets["practice-field"] || 0;
    let message;
    if (pass) {
      const wins = total === 7 || (!crapless && total === 11),
        loses = !crapless && [2, 3, 12].includes(total);
      if (wins) {
        change += pass;
        returned += pass * 2;
        message = `${total} wins on the come-out.`;
      } else if (loses) {
        change -= pass;
        message = `${total} is craps. Pass loses.`;
      } else {
        returned += pass;
        message = `${total} becomes the point. It must repeat before a 7.`;
      }
    } else message = `${total} on the dice.`;
    if (field) {
      const multiple = total === 2 ? 2 : total === 12 ? 3 : 1;
      if (FIELD_NUMBERS.includes(total)) {
        change += field * multiple;
        returned += field * (multiple + 1);
      } else change -= field;
    }
    setBank((n) => n + returned);
    setBets({});
    setResult({ dice, total, change, message });
    setStep(4);
  };
  const replay = () => {
    setBank(PRACTICE_BANK);
    setChips([]);
    setBets({});
    setSelected(null);
    setResult(null);
    setNote(null);
    setStep(0);
  };
  const selectedRow = rows.find((r) => r.id === selected);
  const tile = (row, children, className) => (
    <BetTile
      key={row.id}
      row={row}
      className={className}
      stake={bets[row.id] || 0}
      selected={selected === row.id}
      hovered={drag.hoverId === row.id}
      eligible={amount >= PRACTICE_MIN}
      dragging={drag.dragging}
      teach={teach}
      cue={step === 2 && !drag.dragging}
      onSelect={(r) => setSelected((s) => (s === r.id ? null : r.id))}
    >
      {children}
    </BetTile>
  );
  return (
    <div className="pg-practice">
      <ol className="pg-steps">
        {STEPS.map((item, i) => (
          <li
            key={item.title}
            className={i < step ? "is-done" : i === step ? "is-now" : ""}
            aria-current={i === step ? "step" : undefined}
          >
            <span>{i < step ? <Check size={13} /> : i + 1}</span>
            {item.title}
          </li>
        ))}
      </ol>
      <div className="pg-practice-status">
        <p role="status">
          {step < 4 ? STEPS[step].hint : "Done. That is the whole loop."}
        </p>
        <span>
          Practice chips <b>{money(bank)}</b>
        </span>
      </div>
      {step < 3 && (
        <div className="pg-rack">
          <Tray
            amount={amount}
            bank={bank}
            locked={false}
            onAdd={add}
            cue={step < 2}
          />
          <BundleBar
            chips={chips}
            amount={amount}
            locked={false}
            drag={drag}
            cue={step === 2}
            placeLabel={
              selectedRow && amount ? `Place ${money(amount)}` : "Choose a bet"
            }
            placeDetail={selectedRow?.name}
            canPlace={!!selectedRow && amount > 0 && step >= 2}
            onPlace={() => selectedRow && lay(selectedRow)}
            onUndo={() => setChips((c) => c.slice(0, -1))}
            onClear={() => setChips([])}
            onHint={() =>
              setNote("Drag this onto a bet, or tap a bet and press Place.")
            }
            quick={[]}
          />
          {note && <Notice notice={{ tone: "error", text: note }} />}
        </div>
      )}
      <div className="pg-felt pg-practice-felt">
        <div className="pg-board is-practice">
          {tile(
            rows[0],
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
          {tile(
            rows[1],
            <span className="pg-tile-name is-pass">Pass Line</span>,
            "pg-tile-pass",
          )}
        </div>
      </div>
      {step >= 3 && (
        <div className={`pg-swipe ${step === 3 ? "is-cue" : ""}`}>
          {result ? (
            <div className="pg-practice-result" role="status">
              <span className="pg-strip-dice">
                <Die value={result.dice[0]} />
                <Die value={result.dice[1]} />
                <b>{result.total}</b>
              </span>
              <span className="pg-strip-text">
                <b>{result.message}</b>
                <small>
                  Practice change {signed(result.change)} · no real chips moved
                </small>
              </span>
              <button type="button" className="pg-quick" onClick={replay}>
                <RotateCcw size={14} /> Replay
              </button>
            </div>
          ) : (
            <>
              <div
                className="pg-swipe-pad"
                aria-hidden="true"
                onPointerDown={(e) => {
                  e.currentTarget.setPointerCapture?.(e.pointerId);
                  swipe.current = e.clientY;
                }}
                onPointerUp={(e) => {
                  if (swipe.current != null && swipe.current - e.clientY > 40)
                    throwDice();
                  swipe.current = null;
                }}
                onPointerCancel={() => {
                  swipe.current = null;
                }}
              >
                <ArrowUp size={18} />
                <Die value={5} />
                <Die value={2} />
              </div>
              <button type="button" className="pg-place" onClick={throwDice}>
                <b>Throw practice dice</b>
              </button>
            </>
          )}
        </div>
      )}
      {drag.ghostNode}
    </div>
  );
}

function NumberBall({ n, tone }) {
  return <span className={`pg-ball is-${tone}`}>{n}</span>;
}

function Rules({ mode }) {
  const crapless = mode === "crapless";
  const wins = crapless ? [7] : [7, 11],
    loses = crapless ? [] : [2, 3, 12],
    points = crapless ? [2, 3, 4, 5, 6, 8, 9, 10, 11, 12] : [4, 5, 6, 8, 9, 10];
  return (
    <div className="pg-rules">
      <section>
        <h3>
          <span className="pg-puck is-off">OFF</span> Come-out roll
        </h3>
        <div className="pg-rule-row">
          <span>Pass wins</span>
          <div>
            {wins.map((n) => (
              <NumberBall key={n} n={n} tone="win" />
            ))}
          </div>
        </div>
        {!!loses.length && (
          <div className="pg-rule-row">
            <span>Pass loses</span>
            <div>
              {loses.map((n) => (
                <NumberBall key={n} n={n} tone="loss" />
              ))}
            </div>
          </div>
        )}
        <div className="pg-rule-row">
          <span>Sets the point</span>
          <div>
            {points.map((n) => (
              <NumberBall key={n} n={n} tone="neutral" />
            ))}
          </div>
        </div>
      </section>
      <section>
        <h3>
          <span className="pg-puck is-on">ON</span> Point is set
        </h3>
        <div className="pg-rule-row">
          <span>Pass wins</span>
          <div>
            <NumberBall n="Point" tone="win" />
          </div>
        </div>
        <div className="pg-rule-row">
          <span>Pass loses</span>
          <div>
            <NumberBall n={7} tone="loss" />
          </div>
        </div>
      </section>
      {!crapless && (
        <section>
          <h3>Don’t side</h3>
          <p>
            Come-out: 2, 3 win · 7, 11 lose · 12 pushes. Then 7 must land before
            the point.
          </p>
        </section>
      )}
      <section>
        <h3>Reading a payout</h3>
        <p>
          7:6 means $7 profit per $6 bet. Closed bets also return your stake.
          Place, hard and big bets stay up after a win.
        </p>
      </section>
    </div>
  );
}

function Payouts({ state, player, mode }) {
  const [active, setActive] = useState(null);
  const rows = useMemo(
    () =>
      catalogue(
        { ...state, point: null, config: { ...state.config, mode } },
        mode === state.config.mode ? player : null,
      ),
    [state, player, mode],
  );
  const selected = rows.find((row) => row.id === active);
  return (
    <div className="pg-payouts">
      <table>
        <thead>
          <tr>
            <th scope="col">Bet</th>
            <th scope="col">Pays</th>
            <th scope="col">Win</th>
            <th scope="col">Edge</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className={active === row.id ? "is-active" : ""}>
              <th scope="row">
                <button
                  type="button"
                  aria-pressed={active === row.id}
                  onClick={() => setActive(active === row.id ? null : row.id)}
                >
                  {row.name}
                </button>
              </th>
              <td>{row.payout.split(" · ")[0]}</td>
              <td>{(row.prob * 100).toFixed(1)}%</td>
              <td>{row.edge.toFixed(2)}%</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="pg-payouts-note" role="status">
        {selected?.description || "Tap a bet to see how it works."}
      </p>
    </div>
  );
}

function LearnPanel({ state, player }) {
  const [view, setView] = useState("practice"),
    [mode, setMode] = useState(state.config.mode);
  return (
    <div className="pg-learn">
      <div className="pg-segments" role="group" aria-label="Learn sections">
        {[
          ["practice", "Practice"],
          ["rules", "Rules"],
          ["payouts", "Payouts"],
        ].map(([id, label]) => (
          <button
            type="button"
            key={id}
            aria-pressed={view === id}
            onClick={() => setView(id)}
          >
            {label}
          </button>
        ))}
      </div>
      {view !== "practice" && (
        <div
          className="pg-segments is-small"
          role="group"
          aria-label="Game type"
        >
          {[
            ["craps", "Classic"],
            ["crapless", "Crapless"],
          ].map(([id, label]) => (
            <button
              type="button"
              key={id}
              aria-pressed={mode === id}
              onClick={() => setMode(id)}
            >
              {label}
              {state.config.mode === id && <small>This table</small>}
            </button>
          ))}
        </div>
      )}
      <div className="pg-learn-body">
        {view === "practice" && (
          <Practice mode={state.config.mode} teach={state.config.teach} />
        )}
        {view === "rules" && <Rules mode={mode} />}
        {view === "payouts" && (
          <Payouts state={state} player={player} mode={mode} />
        )}
      </div>
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
    [bundle, setBundle] = useState(() =>
      state.config.minBet <= player.bank
        ? chipsForAmount(state.config.minBet)
        : [],
    );
  const amount = sum(bundle);
  const rows = useMemo(() => catalogue(state, player), [state, player]);
  const selectedRow = rows.find((row) => row.id === selectedId) || null;
  const stake = sum(player.bets.map((b) => b.amount));
  const isShooter = state.shooterId === player.id,
    canThrow = (isShooter || isAdmin) && !state.rolling && connected,
    shooterName =
      state.players.find((p) => p.id === state.shooterId)?.name || "The host",
    canReup = equity(player) < state.config.minBet && !player.bets.length;

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

  useEffect(() => {
    if (state.rolling) setDetailOpen(false);
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
  function wager(row) {
    if (pendingWager) return;
    const issue = betIssue(row, amount, { player, state, connected });
    if (issue) {
      setSelectedId(row.id);
      setNotice({ tone: "error", text: issue.text, fix: issue.fix });
      return;
    }
    setPendingWager({
      row,
      amount,
      before: wagerTotal(row, player.bets),
      deadline: Date.now() + 7000,
    });
    setNotice({ tone: "hint", text: "Placing bet…" });
    Promise.resolve(send({ type: "bet", betId: row.id, amount }))
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
            <div>
              <dt>Bank</dt>
              <dd>{compact(player.bank)}</dd>
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
              busy={!!pendingWager}
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
          {tab === "learn" && <LearnPanel state={state} player={player} />}
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
