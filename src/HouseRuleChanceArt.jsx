import { useId, useRef } from "react";
import "./house-rule-chance-art.css";

// Full-screen CHANCE ROLL scene. Everything before `revealed` is identical
// for every roll and result: the outcome is not rendered, not in classes,
// not in style variables and not in accessible text until the reveal.

const VARIANTS = new Set([
  "secondWind",
  "hardPoint",
  "hotHand",
  "crapsCashback",
  "luckySeven",
  "passTheDice",
  "tableJackpot",
]);

const FACES = ["front", "back", "right", "left", "top", "bottom"];

function clampInt(value, min, max, fallback) {
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

function cleanName(value) {
  return typeof value === "string" ? value.trim().slice(0, 40) : "";
}

// Percentile mapping: tens die 00-90, units die 0-9; 00 + 0 reads as 100.
export function percentileFaces(roll) {
  if (roll === 100) return { tens: "00", units: "0" };
  return {
    tens: String(Math.floor(roll / 10) * 10).padStart(2, "0"),
    units: String(roll % 10),
  };
}

function Die({ kind, value }) {
  return (
    <div className={`hrc-die hrc-die-${kind}`}>
      <div className="hrc-shadow" />
      <div className="hrc-travel">
        <div className="hrc-impact">
          <div className="hrc-spin">
            <div className="hrc-tip">
              <div className="hrc-cube">
                <i className="hrc-core hrc-core-x" />
                <i className="hrc-core hrc-core-y" />
                <i className="hrc-core hrc-core-z" />
                {FACES.map((face) => (
                  <span key={face} className={`hrc-face hrc-face-${face}`}>
                    {face === "front" && value != null ? (
                      <b
                        className={`hrc-digit${value.length > 1 ? " is-pair" : ""}${
                          value === "6" || value === "9" ? " is-marked" : ""
                        }`}
                      >
                        {value}
                      </b>
                    ) : (
                      <i className="hrc-mark" />
                    )}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// Midpoint subdivision and offset branches adapted from Sahil K's
// Lightning-VFX (MIT), https://github.com/SahilK-027/Lightning-VFX.
// See public/licenses/Lightning-VFX-MIT.txt.
function lightningPath(start, end, depth, roughness, random) {
  if (!depth) return [start, end];
  const [x, y] = start;
  const dx = end[0] - x;
  const dy = end[1] - y;
  const along = 0.45 + random() * 0.1;
  const offset = (random() - 0.5) * roughness;
  const middle = [x + dx * along + dy * offset, y + dy * along - dx * offset];
  const left = lightningPath(
    start,
    middle,
    depth - 1,
    roughness * 0.88,
    random,
  );
  const right = lightningPath(middle, end, depth - 1, roughness * 0.88, random);
  return [...left.slice(0, -1), ...right];
}

function createStrike() {
  let seed = 1627;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 0x100000000;
  };
  const impact = [800, 550];
  const main = lightningPath([1335, -28], impact, 6, 0.96, random);
  const arcs = [
    main,
    lightningPath([1386, -26], impact, 5, 0.86, random),
    ...[
      [12, [1538, 120]],
      [19, [1117, 148]],
      [30, [1300, 264]],
      [38, [952, 284]],
      [44, [1163, 478]],
      [53, [628, 486]],
    ].map(([point, end]) => lightningPath(main[point], end, 4, 1.1, random)),
  ];
  return arcs.map((arc) =>
    arc
      .map(([x, y], i) => `${i ? "L" : "M"}${Math.round(x)} ${Math.round(y)}`)
      .join(" "),
  );
}

const STRIKE_PATHS = createStrike();
const SPARKS = [
  [-127, 20],
  [-99, -24],
  [-77, -52],
  [-51, -23],
  [-31, -72],
  [-9, -57],
  [14, -33],
  [41, -63],
  [70, -37],
  [105, -11],
  [134, 12],
  [92, 31],
  [43, 35],
  [-56, 43],
  [-105, 35],
];

function Bolt() {
  const id = useId();
  return (
    <svg
      className="hrc-bolt"
      viewBox="0 0 1600 900"
      preserveAspectRatio="none"
      focusable="false"
    >
      <defs>
        <radialGradient id={id}>
          <stop stopColor="#fffdf2" stopOpacity="0.95" />
          <stop offset="0.23" className="hrc-strike-color" stopOpacity="0.7" />
          <stop offset="1" className="hrc-strike-color" stopOpacity="0" />
        </radialGradient>
      </defs>
      <g className="hrc-bolt-strike">
        <path className="hrc-bolt-glow" d={STRIKE_PATHS[0]} pathLength="1" />
        {STRIKE_PATHS.map((d, index) => (
          <path
            key={d}
            className={index === 0 ? "hrc-bolt-core" : "hrc-bolt-fork"}
            d={d}
            pathLength="1"
            style={{ "--fork-delay": `${10 + index * 13}ms` }}
          />
        ))}
      </g>
      <g transform="translate(800 550)">
        <ellipse
          className="hrc-strike-light"
          rx="265"
          ry="104"
          fill={`url(#${id})`}
        />
        <ellipse className="hrc-strike-ring" rx="178" ry="48" />
        <g className="hrc-strike-sparks">
          {SPARKS.map(([x, y]) => (
            <path
              key={x}
              d={`M${x * 0.38} ${y * 0.38} L${x * 0.61} ${y * 0.61}`}
              style={{ "--spark-x": `${x}px`, "--spark-y": `${y}px` }}
            />
          ))}
        </g>
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
  chance,
  roll,
  hit,
  revealed,
}) {
  // A display joining after the server revealed the result skips the intro.
  const lateReveal = useRef(revealed === true).current;
  const variant = VARIANTS.has(rule) ? rule : "default";
  const title = (typeof label === "string" && label.trim()) || "House Rule";
  const target = clampInt(chance, 0, 100, 0);
  const shown = revealed === true;
  const result = shown ? clampInt(roll, 1, 100, 100) : null;
  const faces = shown ? percentileFaces(result) : { tens: null, units: null };
  const won = shown && hit === true;

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
    shown ? (won ? "is-hit" : "is-miss") : "",
    lateReveal ? "is-late" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={classes} style={{ "--hrc-chance": `${target}%` }}>
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
          <StageFx variant={variant} />
          {variant === "passTheDice" && (
            <div className="hrc-seat">
              <i className="hrc-seat-figure" />
              <span>{roller || holder || "Roller"}</span>
            </div>
          )}
          {won && <div className="hrc-halo" />}
          <div className="hrc-dice">
            <Die kind="tens" value={faces.tens} />
            <Die kind="units" value={faces.units} />
          </div>
          {rollerTag && variant !== "passTheDice" && (
            <div className="hrc-roller">
              <span>Rolled by</span> {rollerTag}
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
            <span className="hrc-v">
              {target}
              <small>%</small>
            </span>
            <span className="hrc-k hrc-need">Roll {target} or under</span>
          </div>
          <div className="hrc-meter">
            <div className="hrc-track">
              <i className="hrc-zone" />
              {shown && (
                <div
                  className="hrc-marker-lane"
                  style={{ "--hrc-pos": `${result}%` }}
                >
                  <i className="hrc-marker" />
                </div>
              )}
            </div>
            <div className="hrc-scale">
              <span>1</span>
              <span>100</span>
            </div>
          </div>
          <div className="hrc-result">
            <span className="hrc-k">Rolled</span>
            {shown ? (
              <span className="hrc-v hrc-roll">{result}</span>
            ) : (
              <span className="hrc-v hrc-pending">– –</span>
            )}
            <span className="hrc-k hrc-verdict">
              {shown ? (won ? "Hit" : "Miss") : "Rolling"}
            </span>
          </div>
        </div>
      </div>
      <div className="hrc-sr" role="status" aria-live="polite">
        {shown
          ? `${title}: rolled ${result} against ${target}. ${won ? "Hit" : "Miss"}.`
          : `${title} chance roll: ${target} percent.`}
      </div>
    </div>
  );
}
