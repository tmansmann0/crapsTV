import { useEffect, useRef, useState } from "react";
import { money } from "./game.js";
import {
  DEFAULT_HOUSE_RULES,
  HOUSE_RULES,
  formatHouseRulePayout,
} from "./house-rules.js";
import HouseRuleArt from "./HouseRuleArt.jsx";
import HouseRuleChanceArt from "./HouseRuleChanceArt.jsx";
import "./house-rule-showcase.css";

// Hold each reveal through the end of its bundled sound accent and voice.
const showcaseDuration = {
  secondWind: 3700,
  hardPoint: 4500,
  hotHand: 4900,
  crapsCashback: 4500,
  luckySeven: 4250,
  passTheDice: 3650,
  tableJackpot: 4700,
};
const speakerCopy = {
  secondWind: () =>
    "The first roll was a 7. Second Wind gives the shooter one reroll.",
  hardPoint: (value) =>
    `Doubles made the point. The Pass Line pays ${formatHouseRulePayout(value)}.`,
  hotHand: (value) =>
    `Three points in one turn. Players ahead on this roll get ${value}% extra profit.`,
  crapsCashback: (value) =>
    `Pass Line bettors get ${value}% of their stake back on this come-out.`,
  luckySeven: (value) =>
    `A 7 on the come-out pays ${formatHouseRulePayout(value)} on the Pass Line.`,
  passTheDice: () =>
    "The shooter made a point and handed the dice to the next player.",
  tableJackpot: (value) =>
    `Three different points made. Each qualifying Pass Line winner gets ${money(value)}.`,
};

export function useHouseRuleShowcase(state, enabled) {
  const [cards, setCards] = useState([]);
  const previous = useRef(null);
  const revealedReroll = useRef(null);
  const live = !!state && state.status === "playing" && !state.pausedAt;
  const rolling = state?.rolling === true;
  const throwId = rolling ? state?.throw?.id : null;
  const secondWind =
    state?.throw?.secondWind === true && !state.throw.houseRuleAttempt;
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
        if (Object.hasOwn(showcaseDuration, rule)) {
          const check = roll.houseRuleAttempts?.find(
            (attempt) => attempt.rule === rule && attempt.hit,
          );
          additions.push({
            id: `${roll.id}:${rule}`,
            room,
            rule,
            value: roll.houseRuleValues?.[rule],
            playerName: check?.playerName,
          });
        }
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

export function HouseRuleChanceShowcase({ prompt }) {
  const { label, rule, phase, rollerName, chance } = prompt;
  return (
    <aside
      className={`house-rule-showcase is-house-rule-chance is-${rule}`}
      aria-label={`${label} chance roll`}
    >
      {phase === "waiting" ? (
        <div className="house-rule-waiting">
          <p>{chance}% trigger chance</p>
          <h2>{label}</h2>
          <p>
            <strong>{rollerName}</strong> has the dice
          </p>
        </div>
      ) : (
        <HouseRuleChanceArt {...prompt} revealed={phase === "revealed"} />
      )}
    </aside>
  );
}

export default function HouseRuleShowcase({ rule, value, playerName }) {
  const { label, setting } = HOUSE_RULES[rule];
  const revealedValue = value ?? DEFAULT_HOUSE_RULES[setting];
  return (
    <aside className={`house-rule-showcase is-${rule}`} aria-label={label}>
      <div className="house-rule-showcase-content">
        <HouseRuleArt rule={rule} value={revealedValue} />
        <h2>{label}</h2>
        <p>
          {playerName && <strong>{playerName} · </strong>}
          {speakerCopy[rule](revealedValue)}
        </p>
      </div>
    </aside>
  );
}
