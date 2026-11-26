import { useRef } from "react";
import HouseRuleDice from "./HouseRuleDice.jsx";
import { describeHouseRuleTarget } from "./house-rules.js";
import "./house-rule-chance-art.css";

const VARIANTS = new Set([
  "secondWind",
  "hardPoint",
  "hotHand",
  "crapsCashback",
  "luckySeven",
  "passTheDice",
  "tableJackpot",
]);

function cleanName(value) {
  return typeof value === "string" ? value.trim().slice(0, 40) : "";
}

function Bolt() {
  const d =
    "M1700 -60 L1236 248 L1330 282 L888 548 L1000 584 L520 860 L606 884 L-80 1080";
  return (
    <svg
      className="hrc-bolt"
      viewBox="0 0 1600 900"
      preserveAspectRatio="none"
      focusable="false"
    >
      <g className="hrc-bolt-strike">
        <path
          className="hrc-bolt-glow"
          d={d}
          vectorEffect="non-scaling-stroke"
        />
        <path
          className="hrc-bolt-core"
          d={d}
          vectorEffect="non-scaling-stroke"
        />
        <path
          className="hrc-bolt-fork"
          d="M888 548 L760 520 L700 590 M1236 248 L1150 200 L1090 236"
          vectorEffect="non-scaling-stroke"
        />
      </g>
    </svg>
  );
}

function Clover() {
  return (
    <g>
      <circle cx="0" cy="-9" r="9" />
      <circle cx="9" cy="0" r="9" />
      <circle cx="0" cy="9" r="9" />
      <circle cx="-9" cy="0" r="9" />
      <path d="M2 10 Q6 22 14 26" fill="none" strokeWidth="3" />
    </g>
  );
}

// Rule-specific scenery around the dice. Drawn in a 1600x600 stage space
// whose dice rest centred at (800, 420).
function StageFx({ variant }) {
  switch (variant) {
    case "secondWind":
      return (
        <svg className="hrc-fx" viewBox="0 0 1600 600" focusable="false">
          <g className="hrc-wind" fill="none" strokeLinecap="round">
            <path
              className="hrc-wind-1"
              d="M-120 150 C 220 60, 420 300, 760 330 S 1150 250, 1400 300"
            />
            <path
              className="hrc-wind-2"
              d="M-120 260 C 200 200, 460 420, 780 420 S 1180 360, 1500 420"
            />
            <path
              className="hrc-wind-3"
              d="M-120 360 C 180 340, 380 500, 700 500 S 1100 470, 1400 520"
            />
          </g>
        </svg>
      );
    case "hardPoint":
      return (
        <svg className="hrc-fx" viewBox="0 0 1600 600" focusable="false">
          <g transform="translate(800 470)">
            <g className="hrc-stamp-ring">
              <ellipse rx="330" ry="72" className="hrc-ring-outer" />
              <ellipse rx="292" ry="60" className="hrc-ring-inner" />
            </g>
            <g className="hrc-cracks">
              <path d="M-330 0 L-420 -14 L-470 10 M330 0 L430 -18 L480 6 M-200 60 L-250 110 M210 58 L270 104" />
            </g>
          </g>
        </svg>
      );
    case "hotHand":
      return (
        <>
          <div className="hrc-sear" />
          <svg className="hrc-fx" viewBox="0 0 1600 600" focusable="false">
            <ellipse
              cx="800"
              cy="480"
              rx="300"
              ry="60"
              className="hrc-scorch"
            />
            {[
              [600, 400],
              [690, 340],
              [930, 330],
              [1010, 410],
              [780, 300],
              [880, 380],
            ].map(([x, y], i) => (
              <circle
                key={i}
                cx={x}
                cy={y}
                r={i % 2 ? 6 : 9}
                className="hrc-ember"
                style={{ "--i": i }}
              />
            ))}
          </svg>
        </>
      );
    case "crapsCashback":
      return (
        <>
          <div className="hrc-frost-sweep" />
          <svg className="hrc-fx" viewBox="0 0 1600 600" focusable="false">
            <g transform="translate(800 470)">
              <g className="hrc-chip-ring">
                <ellipse rx="320" ry="70" className="hrc-chip-edge" />
                <ellipse rx="320" ry="70" className="hrc-chip-dash" />
              </g>
            </g>
            {[
              [260, 460, 18],
              [420, 488, 12],
              [560, 450, 22],
              [1060, 480, 16],
              [1190, 452, 12],
            ].map(([x, y, r], i) => (
              <g key={i} transform={`translate(${x} ${y})`}>
                <g className="hrc-crystal" style={{ "--i": i }}>
                  <path
                    d={`M0 ${-r} V${r} M${-r * 0.87} ${-r / 2} L${r * 0.87} ${r / 2} M${-r * 0.87} ${r / 2} L${r * 0.87} ${-r / 2}`}
                  />
                </g>
              </g>
            ))}
          </svg>
        </>
      );
    case "luckySeven":
      return (
        <svg className="hrc-fx" viewBox="0 0 1600 600" focusable="false">
          <g transform="translate(800 380)">
            <g className="hrc-foil-rays">
              {Array.from({ length: 16 }, (_, i) => (
                <path
                  key={i}
                  d="M-18 -90 L0 -420 L18 -90 Z"
                  transform={`rotate(${i * 22.5})`}
                />
              ))}
            </g>
          </g>
          {[
            [420, 170],
            [1180, 150],
            [1260, 400],
            [330, 420],
            [560, 90],
            [1040, 70],
          ].map(([x, y], i) => (
            <g key={i} transform={`translate(${x} ${y})`}>
              <g className="hrc-clover" style={{ "--i": i }}>
                <Clover />
              </g>
            </g>
          ))}
        </svg>
      );
    case "passTheDice":
      return (
        <svg className="hrc-fx" viewBox="0 0 1600 600" focusable="false">
          {Array.from({ length: 10 }, (_, i) => {
            const t = (i + 1) / 11;
            const x = 250 + 550 * t;
            const y = 470 - 420 * t * (1 - t) * 4 * 0.62 - 40 * t;
            return (
              <circle
                key={i}
                cx={x}
                cy={y}
                r={6 + i * 0.8}
                className="hrc-trail"
                style={{ "--i": i }}
              />
            );
          })}
        </svg>
      );
    case "tableJackpot":
      return (
        <div className="hrc-vault">
          <i className="hrc-bar hrc-bar-top" />
          <i className="hrc-bar hrc-bar-right" />
          <i className="hrc-bar hrc-bar-bottom" />
          <i className="hrc-bar hrc-bar-left" />
          {[0, 1, 2, 3].map((i) => (
            <i key={i} className={`hrc-bolt-stud hrc-stud-${i}`} />
          ))}
        </div>
      );
    default:
      return (
        <svg className="hrc-fx" viewBox="0 0 1600 600" focusable="false">
          <g transform="translate(800 470)">
            <ellipse rx="300" ry="64" className="hrc-felt-ring" />
          </g>
        </svg>
      );
  }
}

export default function HouseRuleChanceArt({
  rule,
  label,
  playerName,
  rollerName,
  target,
  firstDie,
  dice,
  roll,
  hit,
  phase,
  stopDie,
}) {
  // Joining mid-roll should show the current dice without replaying the intro.
  const lateReveal = useRef(phase !== "entering").current;
  const variant = VARIANTS.has(rule) ? rule : "default";
  const title = (typeof label === "string" && label.trim()) || "House Rule";
  const shown = phase === "revealed";
  const secondRolling = phase === "second-rolling";
  const won = shown && hit === true;
  const targetText = describeHouseRuleTarget(target);
  const stopText = secondRolling ? "Stop the second die" : "Stop the first die";
  const cue = shown
    ? ""
    : phase === "between"
      ? "One die to go"
      : phase === "entering"
        ? "Get ready"
        : stopDie
          ? stopText
          : "Rolling";
  const trackPosition = (total) => `${((total - 1.5) / 11) * 100}%`;

  const holder = cleanName(playerName);
  const roller = cleanName(rollerName);
  const same =
    holder && roller && holder.toLowerCase() === roller.toLowerCase();
  const subtitle = holder ? (same ? `${holder} rolls` : `For ${holder}`) : "";
  const rollerTag = roller && !same ? roller : "";

  const classes = [
    "hrc",
    `hrc-v-${variant}`,
    shown ? "is-revealed" : "is-rolling",
    phase === "between" ? "is-between" : "",
    shown ? (won ? "is-hit" : "is-miss") : "",
    lateReveal ? "is-late" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      className={classes}
      style={{ "--hrc-target": `${((target - 1) / 11) * 100}%` }}
    >
      <div className="hrc-scene" aria-hidden="true">
        <div className="hrc-wash" />
        <Bolt />
        <div className="hrc-head">
          <span className="hrc-eyebrow">Chance Roll</span>
          <span className="hrc-title">{title}</span>
          {subtitle && <span className="hrc-holder">{subtitle}</span>}
        </div>

        <div className="hrc-stage">
          <div className="hrc-burst" />
          {phase === "between" && <div className="hrc-hold-light" />}
          <StageFx variant={variant} />
          {variant === "passTheDice" && (
            <div className="hrc-seat">
              <i className="hrc-seat-figure" />
              <span>{roller || holder || "Roller"}</span>
            </div>
          )}
          {won && <div className="hrc-halo" />}
          <HouseRuleDice
            phase={phase}
            firstDie={firstDie}
            secondDie={dice?.[1]}
            lateReveal={lateReveal}
          />
          {rollerTag && variant !== "passTheDice" && (
            <div className="hrc-roller">
              <span>{shown ? "Rolled by" : "Roller"}</span> {rollerTag}
            </div>
          )}
          {shown && (
            <div className="hrc-stamp">
              <span>{won ? "HIT" : "MISS"}</span>
            </div>
          )}
        </div>

        <div className="hrc-panel">
          <div className="hrc-target">
            <span className="hrc-k">Target</span>
            <span className="hrc-v">{target === 1 ? "—" : target}</span>
            <span className="hrc-k hrc-need">{targetText}</span>
          </div>
          <div className="hrc-meter">
            <div className="hrc-track">
              <i className="hrc-zone" />
              {shown && (
                <div
                  className="hrc-marker-lane"
                  style={{ "--hrc-pos": trackPosition(roll) }}
                >
                  <i className="hrc-marker" />
                </div>
              )}
            </div>
            <div className="hrc-scale">
              <span>2</span>
              <span>12</span>
            </div>
          </div>
          <div className="hrc-result">
            <span className="hrc-k">Rolled</span>
            {shown ? (
              <span className="hrc-v hrc-roll">{roll}</span>
            ) : (
              <span className="hrc-v hrc-pending">{firstDie ?? "–"} + –</span>
            )}
            <span className="hrc-k hrc-verdict">
              {shown ? (won ? "Hit" : "Miss") : cue}
            </span>
          </div>
        </div>
      </div>
      <div className="hrc-sr" role="status" aria-live="polite">
        {shown
          ? `${title}: rolled ${dice.join(" and ")}, total ${roll}. ${won ? "Hit" : "Miss"}.`
          : `${title}. ${targetText}. ${firstDie ? `First die: ${firstDie}. ` : ""}${cue}.`}
      </div>
    </div>
  );
}
