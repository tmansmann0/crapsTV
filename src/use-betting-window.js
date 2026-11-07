import { useEffect, useState } from "react";
import { bettingSecondsRemaining } from "./betting-window.js";

export function useBettingWindow(state) {
  const [, tick] = useState(0);
  const remaining = bettingSecondsRemaining(state);
  useEffect(() => {
    if (!remaining) return;
    const timer = setInterval(() => tick((value) => value + 1), 200);
    return () => clearInterval(timer);
  }, [remaining, state.nextRollAt, state.clockOffsetMs]);
  return remaining;
}
