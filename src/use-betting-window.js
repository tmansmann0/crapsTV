import { useEffect, useState } from "react";
import {
  bettingDeadline,
  botRollDeadline,
  secondsUntil,
} from "./betting-window.js";

export function useBettingWindow(state, { includeBot = false } = {}) {
  const [revision, tick] = useState(0);
  const betting = bettingDeadline(state);
  const bot = includeBot ? botRollDeadline(state) : null;
  const deadline = betting === null ? bot : Math.max(betting, bot ?? betting);
  const remaining = secondsUntil(deadline);
  useEffect(() => {
    if (!remaining) return;
    const refresh = () => tick((value) => value + 1);
    // Schedule the label change from the shared deadline, including the final
    // transition to zero, instead of waiting for the next polling interval.
    const nextChange = deadline - (remaining - 1) * 1000;
    const timer = setTimeout(
      refresh,
      Math.max(0, Math.ceil(nextChange - Date.now())),
    );
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, [deadline, remaining, revision]);
  return remaining;
}
