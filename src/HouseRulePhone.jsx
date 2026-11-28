import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Dices, RotateCw } from "lucide-react";
import HouseRuleDice from "./HouseRuleDice.jsx";
import { describeHouseRuleTarget } from "./house-rules.js";
import {
  SUSPENSION_SEND_MS,
  suspensionPoses,
  suspensionVelocities,
} from "./house-rule-fling.js";
import {
  createDiceSuspension,
  simulateChanceDrop,
} from "./house-rule-suspension.js";
import "./house-rule-phone.css";

export default function HouseRulePhone({
  prompt,
  connected,
  clockOffsetMs = 0,
  send,
}) {
  const dialog = useRef(null);
  const gesture = useRef(null);
  const suspension = useRef(null);
  const pendingImpact = useRef(0);
  const motionFeed = useRef({ samples: [], wake: null });
  const [simulating, setSimulating] = useState(false);
  const [holding, setHolding] = useState(false);
  const [pending, setPending] = useState(false);
  const [localDrop, setLocalDrop] = useState(null);
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
      suspension.current?.letGo();
      setHolding(false);
      setSimulating(false);
    }
    if (!connected) {
      setPending(false);
      setLocalDrop(null);
    }
  }, [canFling, connected]);

  const publishMotion = useCallback(
    (poses) => {
      motionFeed.current.samples[0] = {
        promptId: id,
        poses,
        at: Date.now() + clockOffsetMs,
      };
      motionFeed.current.wake?.();
    },
    [clockOffsetMs, id],
  );

  useEffect(() => {
    if (!simulating || !canFling) return;
    let frame;
    let previous = performance.now();
    let lastSend = -Infinity;
    function update(time) {
      const physics = suspension.current;
      const dt = Math.max(0, time - previous) / 1000;
      previous = time;
      const drag = gesture.current;
      if (drag) drag.velocity *= Math.exp((-dt * 1000) / 125);
      const moving = physics.step(dt);
      const poses = physics.sample();
      publishMotion(poses);
      if (!moving || time - lastSend >= SUSPENSION_SEND_MS) {
        lastSend = time;
        const diceImpact = pendingImpact.current;
        pendingImpact.current = 0;
        send({
          type: "house-rule-motion",
          promptId: id,
          poses,
          ...(diceImpact > 0 && { diceImpact }),
        });
      }
      if (moving) frame = requestAnimationFrame(update);
      else setSimulating(false);
    }
    frame = requestAnimationFrame(update);
    return () => cancelAnimationFrame(frame);
  }, [canFling, id, publishMotion, send, simulating]);

  function position(drag, event, seconds) {
    const x = (event.clientX - drag.centerX) / drag.halfWidth;
    const y = (event.clientY - drag.centerY) / drag.halfHeight;
    suspension.current.pullToward(
      Math.max(-1, Math.min(1, x)),
      Math.max(-1, Math.min(1, y)),
      seconds,
    );
    // A pending draw can use this pointer sample on the very next frame.
    publishMotion(suspension.current.sample());
  }

  function hold(event) {
    if (
      !canFling ||
      gesture.current ||
      (event.pointerType === "mouse" && event.button !== 0)
    )
      return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (!suspension.current) {
      const physics = createDiceSuspension(prompt.poses);
      physics.recordContacts(
        (_, { speed, surface }) => {
          if (surface === "dice")
            pendingImpact.current = Math.max(pendingImpact.current, speed);
        },
        () => performance.now(),
      );
      suspension.current = physics;
    }
    const now = performance.now();
    const drag = {
      startedAt: now,
      pointer: event.pointerId,
      centerX: rect.left + rect.width / 2,
      centerY: rect.top + rect.height / 2,
      halfWidth: rect.width / 2,
      // The angled camera foreshortens depth. Use the horizontal display
      // scale for both axes, with room for that projection.
      halfHeight: rect.width * 0.3,
      lastX: event.clientX,
      lastY: event.clientY,
      lastAt: now,
      velocity: 0,
      upward: 0,
      travel: 0,
    };
    position(drag, event);
    gesture.current = drag;
    event.currentTarget.setPointerCapture(event.pointerId);
    setHolding(true);
    setSimulating(true);
  }

  function move(event) {
    const drag = gesture.current;
    if (!canFling || drag?.pointer !== event.pointerId) return;
    const now = performance.now();
    const dx = event.clientX - drag.lastX;
    const dy = event.clientY - drag.lastY;
    const distance = Math.hypot(dx, dy);
    const dt = Math.max(8, now - drag.lastAt);
    const speed = distance / dt;
    drag.velocity = Math.min(2.5, drag.velocity * 0.4 + speed * 0.6);
    if (distance > 2) {
      const upward = Math.max(0, -dy / distance);
      drag.upward = drag.upward * 0.3 + upward * 0.7;
    }

    drag.travel += distance;
    drag.lastX = event.clientX;
    drag.lastY = event.clientY;
    drag.lastAt = now;
    position(drag, event, dt / 1000);
  }

  function sendFling(flick, upward = 0) {
    if (!canFling) return;
    const poses = suspensionPoses(suspension.current?.sample());
    const velocities = suspensionVelocities(suspension.current?.velocities());
    const release =
      Number.isFinite(flick) && poses && velocities
        ? { poses, velocities, flick, upward }
        : undefined;
    const diceImpact = pendingImpact.current;
    pendingImpact.current = 0;
    setPending(true);
    send({
      type: "roll-house-rule",
      promptId: id,
      ...release,
      ...(diceImpact > 0 && { diceImpact }),
    });
    if (release) {
      const startAt = Date.now() + clockOffsetMs;
      const { hops } = simulateChanceDrop(
        release.poses,
        release.velocities,
        flick,
        upward,
      );
      setLocalDrop({ startAt, hops });
    }
  }

  function end(event, released) {
    const drag = gesture.current;
    if (drag?.pointer !== event.pointerId) return;
    if (
      released &&
      (event.clientX !== drag.lastX || event.clientY !== drag.lastY)
    )
      move(event);
    gesture.current = null;
    setHolding(false);
    suspension.current.letGo();
    if (
      released &&
      canFling &&
      (drag.travel > 18 || performance.now() - drag.startedAt > 180)
    ) {
      const flick = Math.min(1, Math.max(0, (drag.velocity - 0.72) / 1.2));
      sendFling(flick, drag.upward);
    }
  }

  const drop =
    localDrop && ((pending && phase === "ready") || phase === "rolling")
      ? localDrop
      : prompt.flight;
  const revealed = phase === "revealed";
  let status = "Both dice";
  let instruction = "Get ready.";
  if (revealed) {
    status = hit ? "Hit" : "Miss";
    instruction = `${dice[0]} + ${dice[1]} = ${roll}`;
  } else if (phase === "resolving") {
    status = "Dice are down";
    instruction = "Reading the roll…";
  } else if (phase === "cocked") {
    status = "Cocked dice";
    instruction = "Roll again.";
  } else if (phase === "rolling" || pending) {
    status = "Rolling";
    instruction = "Watch them land.";
  } else if (canFling) {
    instruction = holding
      ? "Let go to drop or flick to throw."
      : "Hold to lift both dice.";
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
            flight={drop}
            clockOffsetMs={clockOffsetMs}
            result={dice}
            promptId={id}
            motionFeed={phase === "ready" && !drop ? motionFeed : undefined}
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
