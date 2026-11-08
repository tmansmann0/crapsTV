import { useEffect, useMemo, useState } from "react";
import { catalogue, money } from "./game.js";
import "./learn-center.css";

const PIPS = {
  1: [[0, 0]],
  2: [
    [-1, -1],
    [1, 1],
  ],
  3: [
    [-1, -1],
    [0, 0],
    [1, 1],
  ],
  4: [
    [-1, -1],
    [-1, 1],
    [1, -1],
    [1, 1],
  ],
  5: [
    [-1, -1],
    [-1, 1],
    [0, 0],
    [1, -1],
    [1, 1],
  ],
  6: [
    [-1, -1],
    [-1, 0],
    [-1, 1],
    [1, -1],
    [1, 0],
    [1, 1],
  ],
};
const chip = (id, amount, at, profit = false, hidden = false) => ({
  id,
  amount,
  at,
  profit,
  hidden,
});
const frame = (
  caption,
  { dice = null, point = null, chips = [], hot = null } = {},
) => ({ caption, dice, point, chips, hot });
const profit = (row, amount) => {
  const [a, b] = row.payout.split(" · ")[0].split(":").map(Number);
  return Math.round((amount * a) / b);
};

function lessonsFor(mode, branch) {
  // Literal IDs: reading the catalogue must also work on HTTP phone origins
  // where crypto.randomUUID is unavailable. Nothing calls a game action here.
  const demo = { config: { mode, minBet: 500 }, point: 6 };
  const rows = catalogue(demo, {
    bets: [{ id: "lesson-pass", type: "pass", point: 6, amount: 1000 }],
  });
  const get = (id) => rows.find((row) => row.id === id);
  const p = chip("stake", 500, "pass"),
    gain = chip("profit", 500, "house", true, true);
  const isLoss = branch === "lose";
  const passDice =
    branch === "two"
      ? [1, 1]
      : branch === "point"
        ? mode === "crapless"
          ? [5, 6]
          : [2, 4]
        : [3, 4];
  const passTotal = passDice[0] + passDice[1];
  const passWin = passTotal === 7;
  const passLoss = mode === "craps" && passTotal === 2;
  const oddsProfit = profit(get("odds:lesson-pass"), 2500);
  const placeProfit = profit(get("place-6"), 1200);
  const hardProfit = profit(get("hard-8"), 500);
  const fieldTotal = branch === "twelve" ? 12 : branch === "lose" ? 8 : 2;
  const fieldPart = get("field")
    .payout.split(" · ")
    .find((part) => part.startsWith(`${fieldTotal} pays `));
  const fieldProfit = fieldPart
    ? 500 * Number(fieldPart.match(/pays (\d+):/)[1])
    : 0;
  const hardTotal = branch === "easy" ? 8 : branch === "seven" ? 7 : 8;
  const hardWins = branch !== "easy" && branch !== "seven" && branch !== "off";
  return [
    {
      id: "pass",
      title: "Pass line",
      copy:
        mode === "crapless"
          ? "7 wins. Every other number becomes the point, including 2, 3, 11 and 12."
          : "7 or 11 wins; 2, 3 or 12 loses. Other numbers become the point.",
      choices: [
        ["win", "Roll 7"],
        ["two", "Roll 2"],
        ["point", mode === "crapless" ? "Roll 11" : "Roll 6"],
      ],
      steps: [
        frame("Put $5 on Pass before the come-out roll.", {
          chips: [p, gain],
          hot: "pass",
        }),
        frame(`The come-out roll is ${passTotal}.`, {
          dice: passDice,
          chips: [p, gain],
          hot: "pass",
        }),
        frame(
          passWin
            ? "Your $5 stake returns with $5 profit."
            : passLoss
              ? "2 is craps. The $5 stake goes to the house."
              : `${passTotal} becomes the point. The $5 stays on Pass.`,
          {
            dice: passDice,
            point: !passWin && !passLoss ? passTotal : null,
            chips: [
              { ...p, at: passWin ? "bank" : passLoss ? "house" : "pass" },
              { ...gain, at: "bankGain", hidden: !passWin },
            ],
            hot: passWin ? "bank" : passLoss ? "house" : "pass",
          },
        ),
      ],
    },
    {
      id: "point",
      title: "The point",
      copy: "Once a point is set, Pass needs that number again before 7.",
      choices: [
        ["win", "Make 6"],
        ["lose", "Seven out"],
      ],
      steps: [
        frame("6 is the point. Your Pass bet stays put.", {
          dice: [3, 3],
          point: 6,
          chips: [p, gain],
          hot: "six",
        }),
        frame("8 changes nothing. Keep rolling for 6.", {
          dice: [4, 4],
          point: 6,
          chips: [p, gain],
          hot: "six",
        }),
        frame(
          isLoss
            ? "7 arrives first. That is seven out."
            : "6 lands again. The point is made.",
          {
            dice: isLoss ? [3, 4] : [2, 4],
            point: 6,
            chips: [p, gain],
            hot: "pass",
          },
        ),
        frame(
          isLoss
            ? "The Pass stake goes to the house. A new shooter is up."
            : "Stake and profit return. The next roll is a new come-out.",
          {
            dice: isLoss ? [3, 4] : [2, 4],
            chips: [
              { ...p, at: isLoss ? "house" : "bank" },
              { ...gain, at: "bankGain", hidden: isLoss },
            ],
            hot: isLoss ? "house" : "bank",
          },
        ),
      ],
    },
    {
      id: "odds",
      title: "Taking odds",
      copy: "After a Pass point is set, add odds behind the line. This table allows up to 5× your Pass stake.",
      steps: [
        frame("A $10 Pass bet has a point of 6.", {
          dice: [3, 3],
          point: 6,
          chips: [
            chip("line", 1000, "pass"),
            chip("odds", 2500, "bank"),
            chip("line-profit", 1000, "house", true, true),
            chip("odds-profit", oddsProfit, "house", true, true),
          ],
          hot: "pass",
        }),
        frame(
          `Move $25 behind Pass. Your $10 line allows up to ${money(get("odds:lesson-pass").max)} odds.`,
          {
            point: 6,
            chips: [
              chip("line", 1000, "pass"),
              chip("odds", 2500, "odds"),
              chip("line-profit", 1000, "house", true, true),
              chip("odds-profit", oddsProfit, "house", true, true),
            ],
            hot: "odds",
          },
        ),
        frame("6 wins both bets. Odds on 6 pay 6:5 profit.", {
          dice: [2, 4],
          point: 6,
          chips: [
            chip("line", 1000, "pass"),
            chip("odds", 2500, "odds"),
            chip("line-profit", 1000, "house", true, true),
            chip("odds-profit", oddsProfit, "house", true, true),
          ],
          hot: "six",
        }),
        frame(
          `Your $35 stake returns, plus $10 line profit and ${money(oddsProfit)} odds profit.`,
          {
            dice: [2, 4],
            chips: [
              chip("line", 1000, "bank"),
              chip("odds", 2500, "bank2"),
              chip("line-profit", 1000, "bankGain", true),
              chip("odds-profit", oddsProfit, "bankGain2", true),
            ],
            hot: "bank",
          },
        ),
      ],
    },
    {
      id: "place",
      title: "Place bets",
      copy: "A Place 6 wins on 6 before 7. Place bets are off on come-out rolls.",
      steps: [
        frame("With a point on, put $12 on Place 6.", {
          point: 4,
          chips: [
            chip("place", 1200, "place"),
            chip("profit", placeProfit, "house", true, true),
          ],
          hot: "six",
        }),
        frame("6 lands. A Place 6 pays 7:6 profit.", {
          dice: [2, 4],
          point: 4,
          chips: [
            chip("place", 1200, "place"),
            chip("profit", placeProfit, "house", true, true),
          ],
          hot: "six",
        }),
        frame(
          `${money(placeProfit)} profit comes back. The $12 stake stays up.`,
          {
            dice: [2, 4],
            point: 4,
            chips: [
              chip("place", 1200, "place"),
              chip("profit", placeProfit, "bankGain", true),
            ],
            hot: "bank",
          },
        ),
        frame("A later 7 takes the $12 stake. The earlier profit is yours.", {
          dice: [3, 4],
          chips: [
            chip("place", 1200, "house"),
            chip("profit", placeProfit, "bankGain", true),
          ],
          hot: "house",
        }),
      ],
    },
    {
      id: "field",
      title: "Field",
      copy: "Field is a one-roll bet on 2, 3, 4, 9, 10, 11 or 12.",
      choices: [
        ["two", "Roll 2"],
        ["twelve", "Roll 12"],
        ["lose", "Roll 8"],
      ],
      steps: [
        frame("Put $5 in the Field for the very next roll.", {
          chips: [
            chip("field", 500, "field"),
            chip("profit", fieldProfit, "house", true, true),
          ],
          hot: "field",
        }),
        frame(
          `${fieldTotal} lands. ${fieldTotal === 8 ? "That misses the Field." : fieldTotal === 2 ? "2 pays double profit." : "12 pays triple profit."}`,
          {
            dice:
              fieldTotal === 2 ? [1, 1] : fieldTotal === 12 ? [6, 6] : [4, 4],
            chips: [
              chip("field", 500, "field"),
              chip("profit", fieldProfit, "house", true, true),
            ],
            hot: "field",
          },
        ),
        frame(
          fieldProfit
            ? `Your $5 stake returns with ${money(fieldProfit)} profit.`
            : "The $5 stake goes to the house. This bet is finished.",
          {
            dice:
              fieldTotal === 2 ? [1, 1] : fieldTotal === 12 ? [6, 6] : [4, 4],
            chips: [
              chip("field", 500, fieldProfit ? "bank" : "house"),
              chip("profit", fieldProfit, "bankGain", true, !fieldProfit),
            ],
            hot: fieldProfit ? "bank" : "house",
          },
        ),
      ],
    },
    {
      id: "hard",
      title: "Hardways",
      copy: "Hard 8 needs double 4 before an easy 8 or 7. Hardways are off on come-out rolls.",
      choices: [
        ["hard", "Double 4"],
        ["easy", "Easy 8"],
        ["seven", "Roll 7"],
        ["off", "Come-out"],
      ],
      steps: [
        frame(
          branch === "off"
            ? "The puck is OFF. Hardways wait during come-out."
            : "With a point on, put $5 on Hard 8.",
          {
            point: branch === "off" ? null : 6,
            chips: [
              chip("hard", 500, "hard"),
              chip("profit", hardProfit, "house", true, true),
            ],
            hot: "hard",
          },
        ),
        frame(
          branch === "off"
            ? "Double 4 sets a point, but this Hard 8 bet was off."
            : hardWins
              ? "Double 4 is a hard 8. It pays 9:1 profit."
              : branch === "easy"
                ? "3 + 5 is an easy 8. Hard 8 loses."
                : "7 takes the Hard 8 stake.",
          {
            dice:
              branch === "easy" ? [3, 5] : branch === "seven" ? [3, 4] : [4, 4],
            point: branch === "off" ? 8 : 6,
            chips: [
              chip("hard", 500, "hard"),
              chip("profit", hardProfit, "house", true, true),
            ],
            hot: "hard",
          },
        ),
        frame(
          branch === "off"
            ? "The $5 stays on Hard 8, now working with the point on."
            : hardWins
              ? `${money(hardProfit)} profit comes back. The $5 stake stays up.`
              : "The $5 stake goes to the house.",
          {
            dice:
              hardTotal === 7 ? [3, 4] : branch === "easy" ? [3, 5] : [4, 4],
            point: branch === "off" ? 8 : hardTotal === 7 ? null : 6,
            chips: [
              chip(
                "hard",
                500,
                hardWins || branch === "off" ? "hard" : "house",
              ),
              chip("profit", hardProfit, "bankGain", true, !hardWins),
            ],
            hot: hardWins ? "bank" : "hard",
          },
        ),
      ],
    },
    ...(mode === "craps"
      ? [
          {
            id: "dont",
            title: "Don’t pass",
            copy: "Come-out 2 or 3 wins; 7 or 11 loses; 12 pushes. With a point, 7 wins before the point.",
            steps: [
              frame("Put $5 on Don’t Pass before come-out.", {
                chips: [p],
                hot: "pass",
              }),
              frame("12 lands. This is a push, not a win or loss.", {
                dice: [6, 6],
                chips: [p],
                hot: "pass",
              }),
              frame("Only your original $5 returns. No profit is added.", {
                dice: [6, 6],
                chips: [{ ...p, at: "bank" }],
                hot: "bank",
              }),
            ],
          },
        ]
      : []),
  ];
}

function Die({ value, x }) {
  return (
    <g transform={`translate(${x} 8)`} className="lc-die">
      <rect width="29" height="29" rx="5" />
      {PIPS[value]?.map(([a, b], i) => (
        <circle key={i} cx={14.5 + a * 7} cy={14.5 + b * 7} r="2.3" />
      ))}
    </g>
  );
}
function LessonScene({ lesson, step, mode, animateDice }) {
  const nums =
    mode === "crapless"
      ? [2, 3, 4, 5, 6, 8, 9, 10, 11, 12]
      : [4, 5, 6, 8, 9, 10];
  const center = (n) =>
    24 + ((nums.indexOf(n) + 0.5) * 312) / nums.length - 1.5;
  const places = {
    pass: [172, 160],
    odds: [172, 193],
    place: [center(6), 78],
    field: [199, 116],
    hard: [315, 117],
    bank: [43, 229],
    bankGain: [81, 229],
    bank2: [119, 229],
    bankGain2: [157, 229],
    house: [310, 229],
  };
  return (
    <svg
      viewBox="0 0 360 260"
      role="img"
      aria-label={`${lesson.title}: ${step.caption}`}
      className="lc-scene"
    >
      <rect
        x="12"
        y="42"
        width="336"
        height="169"
        rx="15"
        className="lc-felt"
      />
      {step.dice ? (
        <g
          key={`${lesson.id}-${step.dice.join("-")}`}
          className={`lc-dice-pair ${animateDice ? "is-rolling" : ""}`}
        >
          <Die value={step.dice[0]} x={139} />
          <Die value={step.dice[1]} x={173} />
          <text x="214" y="29" className="lc-total">
            {step.dice[0] + step.dice[1]}
          </text>
        </g>
      ) : (
        <text x="151" y="28" className="lc-wait">
          Place a bet
        </text>
      )}
      {nums.map((n, i) => (
        <g key={n} transform={`translate(${24 + (i * 312) / nums.length} 48)`}>
          <rect
            width={312 / nums.length - 3}
            height="44"
            rx="4"
            className={
              step.hot === "six" && n === 6 ? "lc-region is-hot" : "lc-region"
            }
          />
          <text x={(312 / nums.length - 3) / 2} y="14" className="lc-number">
            {n}
          </text>
        </g>
      ))}
      <g
        className={`lc-puck ${step.point ? "is-on" : ""}`}
        style={{
          transform: `translate(${step.point ? center(step.point) : 303}px, ${step.point ? 62 : 22}px)`,
        }}
      >
        <circle r={step.point ? 11 : 17} />
        <text y="4">{step.point || "OFF"}</text>
      </g>
      <rect
        x="24"
        y="99"
        width="197"
        height="38"
        rx="4"
        className={`lc-region ${step.hot === "field" ? "is-hot" : ""}`}
      />
      <text x="119" y="110" className="lc-label">
        FIELD
      </text>
      {[2, 3, 4, 9, 10, 11, 12].map((n, i) => (
        <g key={n} transform={`translate(${39 + i * 22} 126)`}>
          {(n === 2 || n === 12) && (
            <circle r="7.5" className="lc-field-ring" />
          )}
          <text y="3" className="lc-field-number">
            {n}
          </text>
        </g>
      ))}
      <rect
        x="235"
        y="99"
        width="100"
        height="38"
        rx="4"
        className={`lc-region ${step.hot === "hard" ? "is-hot" : ""}`}
      />
      <text x="267" y="120" className="lc-label">
        HARD 8
      </text>
      <rect
        x="24"
        y="145"
        width="311"
        height="30"
        rx="5"
        className={`lc-region ${step.hot === "pass" ? "is-hot" : ""}`}
      />
      <text x="70" y="164" className="lc-label">
        {lesson.id === "dont" ? "DON’T PASS" : "PASS"}
      </text>
      <rect
        x="24"
        y="181"
        width="311"
        height="25"
        rx="4"
        className={`lc-region is-odds ${step.hot === "odds" ? "is-hot" : ""}`}
      />
      <text x="70" y="197" className="lc-label lc-odds-label">
        ODDS
      </text>
      {step.hot === "bank" && (
        <rect
          x="23"
          y="212"
          width="153"
          height="44"
          rx="9"
          className="lc-destination"
        />
      )}
      {step.hot === "house" && (
        <rect
          x="287"
          y="212"
          width="47"
          height="44"
          rx="9"
          className="lc-destination"
        />
      )}
      <text x="72" y="254" className="lc-bank-label">
        YOUR CHIPS
      </text>
      <text x="310" y="254" className="lc-bank-label">
        HOUSE
      </text>
      {step.chips.map((c) => {
        const [x, y] = places[c.at];
        const compact = ["place", "field", "hard"].includes(c.at);
        return (
          <g
            key={c.id}
            className={`lc-chip ${c.profit ? "is-profit" : ""}`}
            style={{
              transform: `translate(${x}px, ${y}px)`,
              opacity: c.hidden ? 0 : 1,
            }}
          >
            <g transform={compact ? "scale(.76)" : undefined}>
              <circle r="16" className="lc-chip-body" />
              <circle r="12.5" className="lc-chip-dash" />
              <text y="4">{money(c.amount)}</text>
            </g>
          </g>
        );
      })}
    </svg>
  );
}

export default function LearnCenter({ state }) {
  const [mode, setMode] = useState(state?.config?.mode || "craps");
  const [lessonId, setLessonId] = useState("pass");
  const [branch, setBranch] = useState("win");
  const [step, setStep] = useState(0);
  const [animateDice, setAnimateDice] = useState(true);
  const [reduced, setReduced] = useState(
    () =>
      typeof matchMedia !== "undefined" &&
      matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const [playing, setPlaying] = useState(!reduced);
  const lessons = useMemo(() => lessonsFor(mode, branch), [mode, branch]);
  const lesson = lessons.find((item) => item.id === lessonId) || lessons[0];
  const current = lesson.steps[Math.min(step, lesson.steps.length - 1)];
  useEffect(() => {
    if (typeof matchMedia === "undefined") return;
    const query = matchMedia("(prefers-reduced-motion: reduce)");
    const change = () => {
      setReduced(query.matches);
      if (query.matches) setPlaying(false);
    };
    query.addEventListener?.("change", change);
    return () => query.removeEventListener?.("change", change);
  }, []);
  useEffect(() => {
    if (!playing || step >= lesson.steps.length - 1) return;
    const id = setTimeout(
      () => {
        setAnimateDice(true);
        setStep((n) => n + 1);
      },
      Math.max(2600, current.caption.length * 42),
    );
    return () => clearTimeout(id);
  }, [playing, step, lesson]);
  const chooseLesson = (id) => {
    setLessonId(id);
    setAnimateDice(true);
    setStep(0);
    setBranch(id === "field" ? "two" : id === "hard" ? "hard" : "win");
    setPlaying(!reduced);
  };
  const changeMode = (value) => {
    setMode(value);
    setAnimateDice(false);
    if (lessonId === "dont" && value === "crapless") setLessonId("pass");
    setStep(0);
    setPlaying(false);
  };
  const move = (delta) => {
    setAnimateDice(delta > 0);
    setPlaying(false);
    setStep((n) => Math.max(0, Math.min(lesson.steps.length - 1, n + delta)));
  };
  return (
    <section
      className="learn-center"
      aria-label="Learn craps"
      data-mode={mode}
      data-lesson={lesson.id}
      data-step={step}
      data-playing={playing && step < lesson.steps.length - 1}
    >
      <div className="lc-top">
        <span>Visual lessons</span>
        <div role="group" aria-label="Lesson game type">
          {[
            ["craps", "Classic"],
            ["crapless", "Crapless"],
          ].map(([id, label]) => (
            <button
              type="button"
              key={id}
              aria-pressed={mode === id}
              onClick={() => changeMode(id)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="lc-heading">
        <label className="lc-select-label">
          Lesson
          <select
            aria-label="Choose a lesson"
            value={lesson.id}
            onChange={(e) => chooseLesson(e.target.value)}
          >
            {lessons.map((item) => (
              <option key={item.id} value={item.id}>
                {item.title}
              </option>
            ))}
          </select>
        </label>
        {lesson.choices && (
          <label className="lc-select-label is-example">
            Example
            <select
              aria-label="Choose an example"
              value={branch}
              onChange={(e) => {
                setBranch(e.target.value);
                setAnimateDice(false);
                setStep(0);
                setPlaying(false);
              }}
            >
              {lesson.choices.map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      <p className="lc-summary">{lesson.copy}</p>
      <div className="lc-stage">
        <LessonScene
          lesson={lesson}
          step={current}
          mode={mode}
          animateDice={animateDice}
        />
      </div>
      <div
        className="lc-caption"
        aria-live={playing && step < lesson.steps.length - 1 ? "off" : "polite"}
        aria-atomic="true"
      >
        <span>
          {step + 1}/{lesson.steps.length}
        </span>
        <p>{current.caption}</p>
      </div>
      <div className="lc-controls" role="group" aria-label="Lesson playback">
        <button
          type="button"
          aria-label="Previous step"
          disabled={step === 0}
          onClick={() => move(-1)}
        >
          ‹
        </button>
        <button
          type="button"
          className="lc-play"
          onClick={() => {
            setAnimateDice(true);
            if (step === lesson.steps.length - 1) setStep(0);
            setPlaying((p) => !p || step === lesson.steps.length - 1);
          }}
        >
          {playing && step < lesson.steps.length - 1 ? "Pause" : "Play"}
        </button>
        <button
          type="button"
          onClick={() => {
            setAnimateDice(true);
            setStep(0);
            setPlaying(!reduced);
          }}
        >
          Replay
        </button>
        <button
          type="button"
          aria-label="Next step"
          disabled={step === lesson.steps.length - 1}
          onClick={() => move(1)}
        >
          ›
        </button>
      </div>
      <p className="lc-demo-note">Demo only · your chips stay unchanged.</p>
    </section>
  );
}
