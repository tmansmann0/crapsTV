import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Dices, RotateCw } from "lucide-react";
import { Quaternion, Vector3 } from "three";
import HouseRuleDice from "./HouseRuleDice.jsx";
import { describeHouseRuleTarget } from "./house-rules.js";
import "./house-rule-phone.css";

const minimumDrag = 22;
const spinAxis = new Vector3();
const spinStep = new Quaternion();

export default function HouseRulePhone({
  prompt,
  connected,
  clockOffsetMs,
  send,
}) {
  const dialog = useRef(null);
  const gesture = useRef(null);
  const [dragging, setDragging] = useState(false);
  const [pendingDie, setPendingDie] = useState(null);
  const title = useId();
  const help = useId();
  const {
    id,
    rule,
    label,
    target,
    phase,
    throwDie,
    firstDie,
    dice,
    hit,
    roll,
  } = prompt;
  const revealed = phase === "revealed";
  const resolving = phase === "resolving";
  const activeDie =
    revealed || resolving ? null : phase.startsWith("second-") ? 2 : 1;
  const waiting =
    pendingDie === activeDie && !prompt.flight && throwDie === activeDie;
  const canThrow =
    connected && !!activeDie && throwDie === activeDie && !waiting;

  useEffect(() => {
    const element = dialog.current;
    element.showModal();
    return () => element.close();
  }, []);

  useEffect(() => {
    if (!connected) setPendingDie(null);
  }, [connected]);

  useEffect(() => {
    if (!canThrow) setDragging(false);
    if (gesture.current?.die !== activeDie) gesture.current = null;
  }, [activeDie, canThrow]);

  function throwCurrent() {
    if (!canThrow) return;
    setPendingDie(activeDie);
    send({ type: "roll-house-rule", promptId: id, die: activeDie });
  }

  function startSpin(event) {
    if (
      !canThrow ||
      (event.pointerType === "mouse" && event.button !== 0) ||
      gesture.current?.pointerId != null
    )
      return;
    const rect = event.currentTarget.getBoundingClientRect();
    gesture.current = {
      die: activeDie,
      pointerId: event.pointerId,
      centerX: rect.left + rect.width / 2,
      centerY: rect.top + rect.height / 2,
      radius: Math.min(rect.width, rect.height) * 0.37,
      lastX: event.clientX,
      lastY: event.clientY,
      travel: 0,
      x: 0,
      z: 0,
      rotation: new Quaternion(),
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
  }

  function spin(event) {
    const current = gesture.current;
    if (!canThrow || current?.pointerId !== event.pointerId) return;

    current.travel += Math.hypot(
      event.clientX - current.lastX,
      event.clientY - current.lastY,
    );
    current.lastX = event.clientX;
    current.lastY = event.clientY;
    const x = (event.clientX - current.centerX) / current.radius;
    const y = (event.clientY - current.centerY) / current.radius;
    const scale = 0.94 / Math.max(1, Math.hypot(x, y));
    const nextX = x * scale;
    const nextZ = y * scale;
    const dx = nextX - current.x;
    const dz = nextZ - current.z;
    const distance = Math.hypot(dx, dz);
    if (distance <= 0.0001) return;
    spinAxis.set(dz / distance, 0, -dx / distance);
    spinStep.setFromAxisAngle(spinAxis, distance * 2.8);
    current.rotation.premultiply(spinStep).normalize();
    current.x = nextX;
    current.z = nextZ;
  }

  function endSpin(event, release) {
    const current = gesture.current;
    if (current?.pointerId !== event.pointerId) return;
    current.pointerId = null;
    setDragging(false);
    if (release && current.travel >= minimumDrag && canThrow) throwCurrent();
    else if (canThrow) gesture.current = null;
  }

  const dieName = activeDie === 2 ? "Second die" : "First die";
  const inFlight = Boolean(prompt.flight) || waiting;
  let status = dieName;
  let instruction = "Get ready.";
  if (revealed) {
    status = hit ? "Hit" : "Miss";
    instruction = `${dice[0]} + ${dice[1]} = ${roll}`;
  } else if (resolving) {
    status = "Dice are down";
    instruction = "Reading the roll…";
  } else if (inFlight) {
    status = `${dieName} rolling`;
    instruction = "Watch it land.";
  } else if (canThrow) {
    instruction = dragging
      ? "Release to throw."
      : "Circle your thumb, then release.";
  }
  if (!connected) instruction = "Reconnecting…";

  return createPortal(
    <dialog
      ref={dialog}
      className={`chance-phone hrc-v-${rule}${dragging ? " is-spinning" : ""}`}
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
          {revealed ? (
            <strong>{roll}</strong>
          ) : (
            firstDie != null && <small>First die · {firstDie}</small>
          )}
        </div>
        <div
          className={`chance-phone__stage${canThrow ? " is-ready" : ""}`}
          data-testid="house-rule-spin"
          onPointerDown={startSpin}
          onPointerMove={spin}
          onPointerUp={(event) => endSpin(event, true)}
          onPointerCancel={(event) => endSpin(event, false)}
          onLostPointerCapture={(event) => endSpin(event, false)}
        >
          {canThrow && (
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
            firstDie={firstDie}
            secondDie={dice?.[1]}
            controller={{ die: activeDie, gesture, dragging }}
          />
        </div>
        <div className="chance-phone__controls">
          <p id={help}>{instruction}</p>
          {activeDie && (
            <button
              type="button"
              disabled={!canThrow || dragging}
              onClick={throwCurrent}
            >
              <Dices size={18} aria-hidden="true" />
              Throw {dieName.toLowerCase()}
            </button>
          )}
        </div>
      </div>
    </dialog>,
    document.body,
  );
}
