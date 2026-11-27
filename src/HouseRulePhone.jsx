import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Dices, RotateCw } from "lucide-react";
import HouseRuleDice from "./HouseRuleDice.jsx";
import { describeHouseRuleTarget } from "./house-rules.js";
import { ORBIT_SEND_MS, orbitInput, orbitSpeed } from "./house-rule-fling.js";
import "./house-rule-phone.css";

export default function HouseRulePhone({
  prompt,
  connected,
  clockOffsetMs = 0,
  send,
}) {
  const dialog = useRef(null);
  const gesture = useRef(null);
  const orbitFeed = useRef({ sample: null, wake: null });
  const [holding, setHolding] = useState(false);
  const [pending, setPending] = useState(false);
  const title = useId();
  const help = useId();
  const { id, rule, label, target, phase, dice, hit, roll } = prompt;
  const canFling =
    connected && phase === "ready" && prompt.canFling && !pending;

  useEffect(() => {
    const element = dialog.current;
    element.showModal();
    return () => element.close();
  }, []);

  useEffect(() => {
    if (!canFling) {
      gesture.current = null;
      setHolding(false);
    }
    if (!connected) setPending(false);
  }, [canFling, connected]);

  useEffect(() => {
    if (!holding || !canFling) return;
    let frame;
    let previous = performance.now();
    let lastSend = -Infinity;
    function update(time) {
      const drag = gesture.current;
      if (!drag) return;
      const dt = Math.min(40, time - previous);
      previous = time;
      const energy = Math.min(1, 0.3 + drag.velocity * 0.8);
      drag.velocity *= Math.exp(-dt / 260);
      drag.turn += dt * orbitSpeed(energy);
      const orbit = orbitInput({ ...drag, energy });
      orbitFeed.current.sample = {
        promptId: id,
        orbit,
        at: Date.now() + clockOffsetMs,
      };
      orbitFeed.current.wake?.();
      if (time - lastSend >= ORBIT_SEND_MS) {
        lastSend = time;
        send({ type: "house-rule-orbit", promptId: id, orbit });
      }
      frame = requestAnimationFrame(update);
    }
    frame = requestAnimationFrame(update);
    return () => cancelAnimationFrame(frame);
  }, [canFling, clockOffsetMs, holding, id, send]);

  function position(drag, event) {
    drag.x = (event.clientX - drag.centerX) / drag.halfWidth;
    drag.y = (event.clientY - drag.centerY) / drag.halfHeight;
  }

  function hold(event) {
    if (
      !canFling ||
      gesture.current ||
      (event.pointerType === "mouse" && event.button !== 0)
    )
      return;
    const rect = event.currentTarget.getBoundingClientRect();
    const drag = {
      pointer: event.pointerId,
      centerX: rect.left + rect.width / 2,
      centerY: rect.top + rect.height / 2,
      halfWidth: rect.width / 2,
      halfHeight: rect.height / 2,
      lastX: event.clientX,
      lastY: event.clientY,
      lastAt: performance.now(),
      velocity: 0,
      travel: 0,
      turn: 0,
    };
    position(drag, event);
    gesture.current = drag;
    event.currentTarget.setPointerCapture(event.pointerId);
    setHolding(true);
  }

  function move(event) {
    const drag = gesture.current;
    if (!canFling || drag?.pointer !== event.pointerId) return;
    const now = performance.now();
    const distance = Math.hypot(
      event.clientX - drag.lastX,
      event.clientY - drag.lastY,
    );
    const speed = distance / Math.max(10, now - drag.lastAt);
    drag.velocity = Math.min(2.5, drag.velocity * 0.4 + speed * 0.6);
    drag.travel += distance;
    drag.lastX = event.clientX;
    drag.lastY = event.clientY;
    drag.lastAt = now;
    position(drag, event);
  }

  function sendFling(orbit, flick) {
    if (!canFling) return;
    setPending(true);
    send({ type: "roll-house-rule", promptId: id, orbit, flick });
  }

  function end(event, released) {
    const drag = gesture.current;
    if (drag?.pointer !== event.pointerId) return;
    gesture.current = null;
    setHolding(false);
    if (released && canFling && drag.travel > 18) {
      const sample = orbitFeed.current.sample?.orbit;
      const orbit = orbitInput({ ...drag, energy: sample?.energy ?? 0.34 });
      sendFling(orbit, Math.min(1, 0.55 + drag.velocity * 0.55));
    } else if (canFling) {
      orbitFeed.current.sample = null;
      orbitFeed.current.wake?.();
      send({ type: "house-rule-orbit", promptId: id, orbit: null });
    }
  }

  const revealed = phase === "revealed";
  let status = "Both dice";
  let instruction = "Get ready.";
  if (revealed) {
    status = hit ? "Hit" : "Miss";
    instruction = `${dice[0]} + ${dice[1]} = ${roll}`;
  } else if (phase === "resolving") {
    status = "Dice are down";
    instruction = "Reading the roll…";
  } else if (phase === "rolling" || pending) {
    status = "Rolling";
    instruction = "Watch them land.";
  } else if (canFling) {
    instruction = holding
      ? "Flick and lift to throw."
      : "Hold to pull both dice into orbit.";
  }
  if (!connected) instruction = "Reconnecting…";

  return createPortal(
    <dialog
      ref={dialog}
      className={`chance-phone hrc-v-${rule}${holding ? " is-spinning" : ""}`}
      aria-labelledby={title}
      aria-describedby={help}
      onCancel={(event) => event.preventDefault()}
    >
      <div className="chance-phone__layout">
        <header className="chance-phone__header">
          <h2 id={title}>{label}</h2>
          <p>{describeHouseRuleTarget(target)}</p>
        </header>
        <div
          className="chance-phone__step"
          role="status"
          data-outcome={revealed ? (hit ? "hit" : "miss") : undefined}
        >
          <span>{status}</span>
          {revealed && <strong>{roll}</strong>}
        </div>
        <div
          className={`chance-phone__stage${canFling ? " is-ready" : ""}`}
          data-testid="house-rule-spin"
          onPointerDown={hold}
          onPointerMove={move}
          onPointerUp={(event) => end(event, true)}
          onPointerCancel={(event) => end(event, false)}
          onLostPointerCapture={(event) => end(event, false)}
        >
          {canFling && !holding && (
            <RotateCw
              className="chance-phone__orbit"
              size={24}
              aria-hidden="true"
            />
          )}
          <HouseRuleDice
            poses={prompt.poses}
            flight={prompt.flight}
            clockOffsetMs={clockOffsetMs}
            result={dice}
            promptId={id}
            orbitFeed={phase === "ready" ? orbitFeed : undefined}
            phone
          />
        </div>
        <div className="chance-phone__controls">
          <p id={help}>{instruction}</p>
          {(phase === "ready" || phase === "entering") && (
            <button
              type="button"
              disabled={!canFling || holding}
              onClick={() => sendFling()}
            >
              <Dices size={18} aria-hidden="true" /> Throw both dice
            </button>
          )}
        </div>
      </div>
    </dialog>,
    document.body,
  );
}
