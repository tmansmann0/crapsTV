import { useId } from "react";
import { DICE_COLORS } from "./dice-colors.js";

const PIPS = [
  [[0, 0]],
  [
    [-12, -12],
    [12, 12],
  ],
];

function PreviewDie({ index, body, finish }) {
  return (
    <g transform={`translate(${index ? 197 : 123} ${index ? 174 : 166})`}>
      <g className={`dice-aim-die dice-aim-die-${index}`}>
        <path d="M-29-4h58v31q0 6-6 7h-46q-6-1-6-7Z" fill={body} />
        <path
          d="M-28 23q0 6 6 7h44q6 0 6-7"
          fill="none"
          stroke="#16090e"
          strokeOpacity=".38"
          strokeWidth="2"
        />
        <rect
          className="dice-aim-die-face"
          x="-29"
          y="-29"
          width="58"
          height="58"
          rx="8"
          fill={finish}
        />
        <path
          d="M-23 1v-16q0-8 8-8h16"
          fill="none"
          stroke="#fff3db"
          strokeOpacity=".34"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
        {PIPS[index].map(([cx, cy]) => (
          <circle
            key={cx}
            cx={cx}
            cy={cy}
            r="4.4"
            fill="#f8edce"
            stroke="#16090e"
            strokeWidth=".7"
            strokeOpacity=".6"
          />
        ))}
      </g>
    </g>
  );
}

export function DiceAimPreview({ appearance, showGuide }) {
  const id = useId();
  const resin = DICE_COLORS[appearance?.color] ?? DICE_COLORS.red;
  const glass = appearance?.finish === "translucent";
  const body = `color-mix(in srgb, ${resin}, #080a0d 36%)`;
  return (
    <svg
      className="dice-aim-preview"
      aria-hidden="true"
      viewBox="0 0 320 250"
      data-color={appearance?.color ?? "red"}
      data-finish={glass ? "translucent" : "solid"}
    >
      <defs>
        <radialGradient id={`${id}-light`} cx="50%" cy="38%" r="66%">
          <stop stopColor="#3d6254" stopOpacity=".43" />
          <stop offset="1" stopColor="#0a1818" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`${id}-resin`} x2=".65" y2="1">
          <stop
            stopColor={`color-mix(in srgb, ${resin}, #ffddc4 ${glass ? "43" : "24"}%)`}
            stopOpacity={glass ? ".64" : "1"}
          />
          <stop
            offset=".53"
            stopColor={resin}
            stopOpacity={glass ? ".72" : "1"}
          />
          <stop offset="1" stopColor={body} />
        </linearGradient>
      </defs>
      <rect width="320" height="250" fill={`url(#${id}-light)`} />
      <g fill="none" stroke="#c5ae80">
        <path
          d="M4 104Q160-16 316 104M-20 113Q160-23 340 113"
          strokeOpacity=".16"
        />
        <path
          d="M160 20v12M105 30l4 9m102-9-4 9M55 51l5 8m205-8-5 8"
          strokeOpacity=".32"
          strokeLinecap="round"
        />
        <path d="M30 201v19h24m236-19v19h-24" strokeOpacity=".18" />
      </g>
      <g className="dice-aim-shift">
        <g transform="translate(160 116)">
          <g className="dice-aim-arrow" data-show-guide={showGuide}>
            <path
              d="M0 2v-64"
              fill="none"
              stroke="#e6c889"
              strokeWidth="2"
              strokeLinecap="round"
              strokeDasharray="2 6"
            />
            <path d="M0-74l-8 13L0-64l8 3Z" fill="#f4d899" />
          </g>
        </g>
        <ellipse
          cx="123"
          cy="198"
          rx="31"
          ry="8"
          fill="#080e10"
          opacity=".52"
        />
        <ellipse
          cx="197"
          cy="207"
          rx="31"
          ry="8"
          fill="#080e10"
          opacity=".52"
        />
        <PreviewDie index={0} body={body} finish={`url(#${id}-resin)`} />
        <PreviewDie index={1} body={body} finish={`url(#${id}-resin)`} />
      </g>
    </svg>
  );
}
