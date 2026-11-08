import { useEffect, useState } from "react";
import {
  bettingSecondsRemaining,
  botRollSecondsRemaining,
} from "./betting-window.js";

export function useBettingWindow(state, { includeBot = false } = {}) {
  const [, tick] = useState(0);
  const remaining = Math.max(
    bettingSecondsRemaining(state),
    includeBot ? botRollSecondsRemaining(state) : 0,
  );
  useEffect(() => {
    if (!remaining) return;
    const timer = setInterval(() => tick((value) => value + 1), 200);
    return () => clearInterval(timer);
  }, [
    remaining,
    state.nextRollAt,
    state.botRollAt,
    state.clockOffsetMs,
    includeBot,
  ]);
  return remaining;
}
