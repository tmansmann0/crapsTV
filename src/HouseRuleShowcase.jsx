import { useEffect, useRef, useState } from "react";
import { HOUSE_RULES } from "./house-rules.js";
import HouseRuleArt from "./HouseRuleArt.jsx";
import "./house-rule-showcase.css";

// Hold each reveal through the end of its bundled sound accent and voice.
const showcaseDuration = {
  secondWind: 3700,
  hardPoint: 4100,
  hotHand: 4900,
  crapsCashback: 4500,
  luckySeven: 4150,
  passTheDice: 3650,
  tableJackpot: 4700,
};
const speakerCopy = {
  secondWind:
    "The first roll was a 7. Second Wind gives the shooter one reroll.",
  hardPoint: "Doubles made the point. The Pass Line pays 5:4.",
  hotHand:
    "Three points in one turn. Players ahead on this roll get 25% extra profit.",
  crapsCashback:
    "Pass Line bettors get half their stake back on this come-out.",
  luckySeven: "A 7 on the come-out pays 2:1 on the Pass Line.",
  passTheDice:
    "The shooter made a point and handed the dice to the next player.",
  tableJackpot:
    "Three different points made. Qualifying Pass Line winners get the jackpot.",
};

export function useHouseRuleShowcase(state, enabled) {
  const [cards, setCards] = useState([]);
  const previous = useRef(null);
  const revealedReroll = useRef(null);
  const live = !!state && state.status === "playing" && !state.pausedAt;
  const rolling = state?.rolling === true;
  const throwId = rolling ? state?.throw?.id : null;
  const secondWind = state?.throw?.secondWind === true;
  const roll = state?.lastRoll;
  const newest = state?.log?.[0];
  const logId = newest?.id;
  const pass = newest?.type === "house-pass-the-dice";
  const room = state ? `${state.code}:${state.createdAt}` : null;

  useEffect(() => {
    const last = previous.current;
    previous.current = { room, throwId, rollId: roll?.id, logId, rolling };
    if (!enabled || !live || !last || last.room !== room) {
      setCards((current) => (current.length ? [] : current));
      revealedReroll.current = null;
      return;
    }
    if (rolling && (!last.rolling || last.throwId !== throwId)) {
      if (secondWind && throwId) {
        revealedReroll.current = throwId;
        setCards([{ id: throwId, room, rule: "secondWind" }]);
      } else setCards([]);
      return;
    }
    const additions = [];
    if (roll?.id && last.rollId !== roll.id) {
      for (const rule of roll.houseRulesTriggered ?? []) {
        if (
          rule === "secondWind" &&
          roll.throwId &&
          revealedReroll.current === roll.throwId
        )
          continue;
        if (HOUSE_RULES[rule])
          additions.push({ id: `${roll.id}:${rule}`, room, rule });
      }
    }
    if (pass && logId !== last.logId)
      additions.push({ id: logId, room, rule: "passTheDice" });
    if (additions.length) setCards((current) => [...current, ...additions]);
  }, [
    enabled,
    live,
    room,
    rolling,
    throwId,
    secondWind,
    roll?.id,
    logId,
    pass,
  ]);

  const card = enabled && live && cards[0]?.room === room ? cards[0] : null;
  useEffect(() => {
    if (!card) return;
    const duration = showcaseDuration[card.rule];
    const timeout = setTimeout(() => {
      setCards((current) =>
        current[0]?.id === card.id ? current.slice(1) : current,
      );
    }, duration);
    return () => clearTimeout(timeout);
  }, [card]);
  return card;
}

export default function HouseRuleShowcase({ rule }) {
  return (
    <aside
      className={`house-rule-showcase is-${rule}`}
      aria-label={HOUSE_RULES[rule].label}
    >
      <div className="house-rule-showcase-content">
        <HouseRuleArt rule={rule} />
        <h2>{HOUSE_RULES[rule].label}</h2>
        <p>{speakerCopy[rule]}</p>
      </div>
    </aside>
  );
}
