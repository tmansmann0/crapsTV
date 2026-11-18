import { lazy, Suspense, useEffect, useRef } from "react";
import { useBettingWindow } from "./use-betting-window.js";
import { AIM_INTERVAL_MS, smoothAim } from "./aim-preview.js";
import { DICE_COLORS as colors } from "./dice-colors.js";
import { DiceAimPreview } from "./DiceAimPreview.jsx";
import "./dice-throw.css";

const loadFlight = () => import("./PhoneDiceFlight.jsx");
const PhoneDiceFlight = lazy(loadFlight);

function gestureAt(drag, e) {
  const dx = e.clientX - drag.x;
  const dy = drag.y - e.clientY;
  return {
    x: Math.max(-1, Math.min(1, dx / 110)),
    power: Math.max(0, Math.min(1, dy / 130)),
  };
}

export default function DiceThrow({ state, roomAim, player, send, connected }) {
  const host = useRef(null);
  const powerLabel = useRef(null);
  const latest = useRef(null);
  const drag = useRef(null);
  const lastAimSent = useRef(0);
  const pendingSend = useRef(null);
  const frame = useRef(0);
  const displayedRemote = useRef(null);
  const lastDrawn = useRef(null);
  const lastFrame = useRef(0);
  const reducedMotion = useRef(null);
  const observedThrow = useRef(state.rolling ? state.throw?.id : null);
  const shooter = state.players.find((p) => p.id === state.shooterId);
  if (state.rolling && state.throw?.id) observedThrow.current = state.throw.id;
  const justLanded =
    !!observedThrow.current &&
    !state.rolling &&
    state.lastRoll?.throwId === observedThrow.current;
  const showingFlight =
    !!state.throw &&
    (state.rolling || state.throw.id === observedThrow.current);
  const remaining = useBettingWindow(state);
  const isShooter = player.id === state.shooterId;
  const canCustomize = connected && !state.rolling && isShooter;
  const canThrow = canCustomize && !justLanded && remaining === 0;
  latest.current = {
    canThrow,
    connected,
    showingFlight,
    send,
    playerId: player.id,
  };

  function schedulePreview() {
    if (!frame.current) frame.current = requestAnimationFrame(drawPreview);
  }

  function drawPreview(time) {
    frame.current = 0;
    const sharedAim =
      latest.current.connected && !latest.current.showingFlight
        ? roomAim?.get()
        : null;
    // The controlling phone draws from its pointer rather than its own echo.
    const remote =
      sharedAim?.playerId === latest.current.playerId ? null : sharedAim;
    displayedRemote.current = smoothAim(
      displayedRemote.current,
      remote,
      time - lastFrame.current,
      reducedMotion.current?.matches,
    );
    lastFrame.current = time;
    const aim = drag.current?.aim ?? displayedRemote.current;
    if (aim !== lastDrawn.current) {
      const el = host.current;
      const { x, power } = aim ?? { x: 0, power: 0 };
      el.dataset.aiming = String(!!aim);
      el.style.setProperty("--aim-shift", `${x * 26}px`);
      el.style.setProperty("--aim-angle", `${Math.atan(x * 0.38)}rad`);
      el.style.setProperty("--aim-lift", `${-power * 12}px`);
      el.style.setProperty("--aim-power", power);
      powerLabel.current.textContent = `${Math.round(power * 100)}% POWER`;
      lastDrawn.current = aim;
    }
    if (
      remote?.active &&
      (displayedRemote.current?.x !== remote.x ||
        displayedRemote.current?.power !== remote.power)
    )
      schedulePreview();
  }

  function publishAim() {
    pendingSend.current = null;
    if (!drag.current || !latest.current.canThrow) return;
    lastAimSent.current = performance.now();
    latest.current.send({
      type: "aim",
      aim: { ...drag.current.aim, active: true },
    });
  }

  function queueAim() {
    if (pendingSend.current !== null) return;
    const wait = AIM_INTERVAL_MS - (performance.now() - lastAimSent.current);
    if (wait <= 0) publishAim();
    else pendingSend.current = setTimeout(publishAim, wait);
  }

  function endDrag(e, cancel = false) {
    const active = drag.current;
    if (!active || (e && e.pointerId !== active.pointerId)) return;
    drag.current = null;
    clearTimeout(pendingSend.current);
    pendingSend.current = null;
    schedulePreview();
    if (!latest.current.canThrow) return;
    if (!cancel && active.y - e.clientY > 20) {
      // Use the release event itself, even if a preview frame or packet is pending.
      send({ type: "roll", gesture: gestureAt(active, e) });
    } else latest.current.send({ type: "aim", aim: { active: false } });
  }

  useEffect(() => {
    const unsubscribe = roomAim?.subscribe(schedulePreview);
    reducedMotion.current = matchMedia("(prefers-reduced-motion: reduce)");
    const cancel = () => endDrag(null, true);
    window.addEventListener("blur", cancel);
    schedulePreview();
    return () => {
      cancel();
      cancelAnimationFrame(frame.current);
      frame.current = 0;
      unsubscribe?.();
      window.removeEventListener("blur", cancel);
    };
  }, [roomAim]);

  useEffect(() => {
    if (!canThrow) endDrag(null, true);
    schedulePreview();
  }, [canThrow, showingFlight, connected]);

  useEffect(() => {
    if (showingFlight) return;
    const preload = () =>
      loadFlight()
        .then((module) => module.preloadDiceFlight())
        .catch(() => {});
    if (window.requestIdleCallback) {
      const task = window.requestIdleCallback(preload);
      return () => window.cancelIdleCallback(task);
    }
    const task = setTimeout(preload, 250);
    return () => clearTimeout(task);
  }, [showingFlight]);

  const pendingChoice = useRef(shooter?.dice),
    waitingChoice = useRef(null);
  useEffect(() => {
    const incoming = shooter?.dice,
      waiting = waitingChoice.current;
    if (
      !waiting ||
      state.rolling ||
      !incoming ||
      (incoming.color === waiting.color && incoming.finish === waiting.finish)
    ) {
      pendingChoice.current = incoming;
      waitingChoice.current = null;
    }
  }, [shooter?.dice, shooter?.id, state.rolling]);
  function choose(patch) {
    const appearance = {
      ...(pendingChoice.current || { color: "red", finish: "solid" }),
      ...patch,
    };
    pendingChoice.current = appearance;
    waitingChoice.current = appearance;
    send({ type: "dice", appearance });
  }
  const flightAppearance = state.players.find(
    (p) => p.id === state.throw?.shooterId,
  )?.dice;
  return (
    <section className="dice-throw" aria-label="Dice throw">
      <div className="dice-throw-top">
        <strong role="status">
          {state.rolling
            ? "Dice are out"
            : justLanded
              ? "Dice landed"
              : canThrow
                ? "Your throw"
                : `${shooter?.name || "Shooter"} has the dice`}
        </strong>
        <span className="dice-throw-status">
          {state.rolling
            ? "LIVE WITH TV"
            : justLanded
              ? "RETURNING TO PLAY"
              : remaining > 0
                ? `BETTING OPEN · ${remaining}s`
                : "AIM PREVIEW"}
        </span>
        <span className="dice-power-text" ref={powerLabel} />
      </div>
      <div
        ref={host}
        className="dice-throw-view"
        data-testid="phone-dice"
        data-loaded="true"
        data-view={
          showingFlight ? (state.rolling ? "rolling" : "landed") : "ready"
        }
        data-throw-id={state.throw?.id || ""}
        data-draggable={canThrow}
        role={canThrow ? "application" : "group"}
        aria-label={
          canThrow
            ? "Swipe dice upward to throw or use the Roll the dice button"
            : "Dice close-up"
        }
        onPointerDown={(e) => {
          if (!canThrow || drag.current || e.button !== 0) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          drag.current = {
            x: e.clientX,
            y: e.clientY,
            pointerId: e.pointerId,
            aim: { x: 0, power: 0 },
          };
          schedulePreview();
          publishAim();
        }}
        onPointerMove={(e) => {
          if (e.pointerId !== drag.current?.pointerId || !canThrow) return;
          drag.current.aim = gestureAt(drag.current, e);
          schedulePreview();
          queueAim();
        }}
        onPointerUp={endDrag}
        onPointerCancel={(e) => endDrag(e, true)}
        onLostPointerCapture={(e) => endDrag(e, true)}
      >
        <DiceAimPreview
          appearance={shooter?.dice}
          showGuide={!showingFlight && canThrow}
        />
        {showingFlight && (
          <Suspense fallback={null}>
            <PhoneDiceFlight
              key={state.throw.id}
              flight={state.throw}
              appearance={flightAppearance ?? { color: "red", finish: "solid" }}
              clockOffsetMs={state.clockOffsetMs}
            />
          </Suspense>
        )}
        {!state.rolling && canThrow && (
          <div className="dice-swipe-hint">Swipe up to throw</div>
        )}
        <div className="dice-power" aria-hidden="true">
          <i />
        </div>
      </div>
      <div className="dice-throw-bottom">
        {isShooter && (
          <div className="dice-appearance" aria-label="Dice appearance">
            {Object.keys(colors).map((color) => (
              <button
                key={color}
                aria-label={`${color} dice`}
                aria-pressed={shooter?.dice?.color === color}
                disabled={!canCustomize}
                style={{ "--die": colors[color] }}
                onClick={() => choose({ color })}
              />
            ))}
            <button
              className="dice-glass"
              aria-label="Solid dice"
              aria-pressed={shooter?.dice?.finish !== "translucent"}
              disabled={!canCustomize}
              onClick={() => choose({ finish: "solid" })}
            >
              Solid
            </button>
            <button
              className="dice-glass"
              aria-label="Translucent dice"
              aria-pressed={shooter?.dice?.finish === "translucent"}
              disabled={!canCustomize}
              onClick={() => choose({ finish: "translucent" })}
            >
              Glass
            </button>
          </div>
        )}
        {canThrow && (
          <button
            className="dice-roll-button"
            onClick={() => send({ type: "roll" })}
          >
            Roll the dice
          </button>
        )}
        {!state.rolling && !justLanded && remaining > 0 && isShooter && (
          <button className="dice-roll-button" disabled>
            Betting open · {remaining}s
          </button>
        )}
        {state.rolling && (
          <button className="dice-roll-button" disabled>
            Dice are rolling…
          </button>
        )}
      </div>
    </section>
  );
}
