import "./house-rule-art.css";

// Every reveal is one 640x400 SVG stage. Positions live in transform
// attributes on outer groups; CSS animates the inner groups, so the
// unanimated (reduced-motion) styles are always the finished frame.

const PIPS = {
  1: [[50, 50]],
  2: [
    [27, 27],
    [73, 73],
  ],
  3: [
    [27, 27],
    [50, 50],
    [73, 73],
  ],
  4: [
    [27, 27],
    [73, 27],
    [27, 73],
    [73, 73],
  ],
  5: [
    [27, 27],
    [73, 27],
    [50, 50],
    [27, 73],
    [73, 73],
  ],
  6: [
    [27, 25],
    [73, 25],
    [27, 50],
    [73, 50],
    [27, 75],
    [73, 75],
  ],
};

function Defs() {
  return (
    <defs>
      <linearGradient id="hr-ivory" x1="0" y1="0" x2="0.4" y2="1">
        <stop offset="0" stopColor="#fffaf0" />
        <stop offset="0.55" stopColor="#f6e8c6" />
        <stop offset="1" stopColor="#dcc597" />
      </linearGradient>
      <linearGradient id="hr-gold" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor="#fff1b8" />
        <stop offset="0.28" stopColor="#f4c64e" />
        <stop offset="0.52" stopColor="#b8801f" />
        <stop offset="0.74" stopColor="#ffd970" />
        <stop offset="1" stopColor="#9c6716" />
      </linearGradient>
      <linearGradient id="hr-gold-edge" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#8a5a12" />
        <stop offset="1" stopColor="#4a2f07" />
      </linearGradient>
      <radialGradient id="hr-glow">
        <stop offset="0" stopColor="var(--rule-accent)" stopOpacity="0.55" />
        <stop offset="0.45" stopColor="var(--rule-accent)" stopOpacity="0.16" />
        <stop offset="1" stopColor="var(--rule-accent)" stopOpacity="0" />
      </radialGradient>
      <radialGradient id="hr-gold-glow">
        <stop offset="0" stopColor="#ffe38a" stopOpacity="0.8" />
        <stop offset="0.4" stopColor="#f2b93b" stopOpacity="0.25" />
        <stop offset="1" stopColor="#f2b93b" stopOpacity="0" />
      </radialGradient>
      <linearGradient id="hr-shine" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stopColor="#fff" stopOpacity="0" />
        <stop offset="0.5" stopColor="#fff" stopOpacity="0.9" />
        <stop offset="1" stopColor="#fff" stopOpacity="0" />
      </linearGradient>
    </defs>
  );
}

function Die({ value, blank, size = 100 }) {
  const s = size / 100;
  return (
    <g transform={`scale(${s}) translate(-50 -50)`}>
      <rect x="2" y="9" width="96" height="96" rx="21" fill="#7d6236" />
      <rect
        x="0"
        y="0"
        width="100"
        height="100"
        rx="21"
        fill="url(#hr-ivory)"
        stroke="#fff6dc"
        strokeWidth="2"
      />
      {blank ? (
        <g className="hr-die-mark" fill="none" strokeLinecap="round">
          <path d="M28 40 Q50 26 72 40" />
          <path d="M22 56 Q50 40 78 56" />
          <path d="M30 72 Q50 60 70 72" />
        </g>
      ) : (
        (PIPS[value] ?? []).map(([x, y]) => (
          <circle key={`${x}-${y}`} cx={x} cy={y} r="9.5" fill="#123a2b" />
        ))
      )}
    </g>
  );
}

function Chip({ fill = "#c8323a", edge = "#7a1820", top = 0 }) {
  // An isometric chip, 120 wide, 16 tall; the group origin is the top centre.
  return (
    <g transform={`translate(0 ${top})`}>
      <path
        d="M-60 0 V14 A60 22 0 0 0 60 14 V0 Z"
        fill={edge}
        stroke="#00000040"
        strokeWidth="1"
      />
      <path
        d="M-46 13 v12 M-16 20 v14 M16 20 v14 M46 13 v12"
        stroke="#fff2d0"
        strokeWidth="7"
        opacity="0.85"
      />
      <ellipse rx="60" ry="22" fill={fill} stroke="#ffffff30" />
      <ellipse rx="40" ry="14" fill="none" stroke="#fff2d0" strokeWidth="3" strokeDasharray="10 9" opacity="0.8" />
    </g>
  );
}

function Puck({ label, sub, lit }) {
  return (
    <g>
      <circle r="52" fill={lit ? "#fff7e2" : "#1b3a2d"} stroke={lit ? "#f5c757" : "#5f7d6b"} strokeWidth="6" />
      <circle r="41" fill="none" stroke={lit ? "#d39a2a" : "#3e5c4b"} strokeWidth="2" />
      <text
        y={sub ? 9 : 16}
        textAnchor="middle"
        className="hr-num"
        fontSize={sub ? 40 : 46}
        fill={lit ? "#13382a" : "#88a593"}
      >
        {label}
      </text>
      {sub && (
        <text y="31" textAnchor="middle" className="hr-label" fontSize="12" fill={lit ? "#8d5f12" : "#6c8a78"}>
          {sub}
        </text>
      )}
    </g>
  );
}

function Star({ r = 14 }) {
  const k = r * 0.22;
  return <path d={`M0 ${-r} L${k} ${-k} L${r} 0 L${k} ${k} L0 ${r} L${-k} ${k} L${-r} 0 L${-k} ${-k} Z`} />;
}

function Rays({ count = 18, inner = 70, outer = 250, className = "" }) {
  const step = 360 / count;
  const half = step * 0.22 * (Math.PI / 180);
  const d = Array.from({ length: count }, (_, i) => {
    const a = i * step * (Math.PI / 180);
    const p = (r, o) => `${(Math.cos(a + o) * r).toFixed(1)} ${(Math.sin(a + o) * r).toFixed(1)}`;
    return `M${p(inner, 0)} L${p(outer, -half)} L${p(outer, half)} Z`;
  }).join(" ");
  return <path className={className} d={d} />;
}

/* ---------------- Second Wind ---------------- */
function SecondWind() {
  return (
    <>
      <circle cx="320" cy="210" r="190" fill="url(#hr-glow)" className="hr-fade" />
      <g transform="translate(320 210)">
        <g className="sw-loop hr-c">
          <path d="M-150 0 A150 150 0 0 1 106 -106" className="sw-arc" />
          <path d="M150 0 A150 150 0 0 1 -106 106" className="sw-arc" />
          <path d="M92 -128 L124 -100 L84 -88 Z" className="sw-arrowhead" />
          <path d="M-92 128 L-124 100 L-84 88 Z" className="sw-arrowhead" />
        </g>
      </g>
      {/* the seven that gets swept away */}
      <g className="sw-old">
        <g transform="translate(250 205)">
          <g className="sw-old-left hr-c">
            <g transform="rotate(-12)">
              <Die value={3} size={108} />
            </g>
          </g>
        </g>
        <g transform="translate(392 212)">
          <g className="sw-old-right hr-c">
            <g transform="rotate(10)">
              <Die value={4} size={108} />
            </g>
          </g>
        </g>
        <g transform="translate(321 92)" className="sw-seven">
          <rect x="-40" y="-24" width="80" height="44" rx="22" fill="#c8323a" />
          <text y="12" textAnchor="middle" className="hr-num" fontSize="34" fill="#fff2d0">
            7
          </text>
        </g>
      </g>
      {/* the gust */}
      <g className="sw-gust" fill="none" strokeLinecap="round">
        <path d="M-40 150 C 120 120, 260 190, 420 150 S 640 130, 700 160" strokeWidth="7" />
        <path d="M-80 215 C 100 185, 300 250, 470 205 S 640 190, 720 215" strokeWidth="11" />
        <path d="M-20 280 C 150 255, 300 310, 440 270 S 620 260, 700 285" strokeWidth="5" />
      </g>
      {/* fresh dice, faces still turning */}
      <g transform="translate(252 212)">
        <g className="sw-new sw-new-left hr-c">
          <g className="sw-flip hr-c">
            <Die blank size={112} />
          </g>
        </g>
      </g>
      <g transform="translate(390 212)">
        <g className="sw-new sw-new-right hr-c">
          <g className="sw-flip hr-c">
            <Die blank size={112} />
          </g>
        </g>
      </g>
      <g className="sw-tag hr-c" transform="translate(320 352)">
        <rect x="-86" y="-20" width="172" height="40" rx="20" className="hr-pill" />
        <text y="8" textAnchor="middle" className="hr-label" fontSize="20">
          REROLL
        </text>
      </g>
    </>
  );
}

/* ---------------- Hard Point ---------------- */
function HardPoint() {
  return (
    <>
      <circle cx="320" cy="200" r="200" fill="url(#hr-gold-glow)" className="hp-glow" />
      <g transform="translate(320 200)">
        <circle r="150" className="hp-shock hp-shock-1" />
        <circle r="150" className="hp-shock hp-shock-2" />
        <g className="hp-sparks">
          <Rays count={12} inner={165} outer={205} />
        </g>
      </g>
      <g className="hp-shake">
        <g transform="translate(320 200)">
          <g className="hp-ring hr-c">
            <circle r="150" fill="none" stroke="url(#hr-gold)" strokeWidth="22" />
            <circle r="164" fill="none" stroke="#f8d77b" strokeWidth="2" />
            <circle r="136" fill="none" stroke="#7a4f0e" strokeWidth="2" />
            {Array.from({ length: 24 }, (_, i) => (
              <rect key={i} x="-2" y="-160" width="4" height="20" fill="#6b440b" transform={`rotate(${i * 15})`} opacity="0.55" />
            ))}
            <g transform="translate(0 -150)">
              <rect x="-62" y="-20" width="124" height="40" rx="8" fill="#12382a" stroke="#f5c757" strokeWidth="3" />
              <text y="9" textAnchor="middle" className="hr-label" fontSize="24" fill="#ffe7a1">
                HARD
              </text>
            </g>
          </g>
        </g>
        <g transform="translate(252 208)">
          <g className="hp-die hp-die-left hr-c">
            <g transform="rotate(-6)">
              <Die value={4} size={122} />
            </g>
          </g>
        </g>
        <g transform="translate(390 208)">
          <g className="hp-die hp-die-right hr-c">
            <g transform="rotate(6)">
              <Die value={4} size={122} />
            </g>
          </g>
        </g>
      </g>
    </>
  );
}

/* ---------------- Hot Hand ---------------- */
function Flame({ i }) {
  return (
    <g className={`hh-flame hh-flame-${i} hr-c`}>
      <path
        d="M0 -150 C 30 -110, 62 -84, 58 -38 C 56 -4, 30 18, 0 18 C -30 18, -56 -4, -58 -38 C -60 -72, -36 -88, -26 -120 C -14 -96, -6 -84, 4 -86 C 4 -108, -6 -126, 0 -150 Z"
        fill="#ff6a1f"
      />
      <path
        d="M0 -96 C 18 -72, 36 -54, 34 -28 C 32 -6, 18 6, 0 6 C -18 6, -32 -6, -34 -26 C -36 -48, -18 -60, -10 -80 C -4 -64, 6 -62, 8 -64 Z"
        fill="#ffc44d"
      />
    </g>
  );
}

function HotHand() {
  const xs = [140, 320, 500];
  return (
    <>
      <ellipse cx="320" cy="230" rx="320" ry="170" fill="url(#hr-glow)" className="hh-heat" />
      {xs.map((x, i) => (
        <g key={x} transform={`translate(${x} 250)`}>
          <g className={`hh-fire hh-fire-${i}`}>
            <Flame i={i} />
          </g>
          <g className={`hh-puck hh-puck-${i} hr-c`}>
            <g className="hh-dim">
              <Puck label={i + 1} sub="POINT" />
            </g>
            <g className={`hh-lit hh-lit-${i}`}>
              <Puck label={i + 1} sub="POINT" lit />
            </g>
          </g>
        </g>
      ))}
      <g className="hh-streak">
        <path d="M-260 236 C -140 200, -40 212, 40 236 C -40 260, -140 272, -260 236 Z" fill="#ffd36b" opacity="0.95" />
        <path d="M-300 236 C -180 214, -80 222, 0 236 C -80 250, -180 258, -300 236 Z" fill="#fff4cf" />
      </g>
      <g className="hh-embers" fill="#ffcf6a">
        {[
          [150, 150],
          [230, 120],
          [300, 160],
          [380, 110],
          [440, 150],
          [520, 125],
          [260, 330],
          [420, 335],
        ].map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r={i % 3 ? 4 : 6} className="hh-ember" style={{ "--i": i }} />
        ))}
      </g>
    </>
  );
}

/* ---------------- Craps Cashback ---------------- */
function CrapsCashback() {
  const chip = (i) => <Chip key={i} top={-i * 16} fill="#2f6fc4" edge="#173a6e" />;
  return (
    <>
      <circle cx="320" cy="220" r="200" fill="url(#hr-glow)" className="hr-fade" />
      {/* the full stake's footprint */}
      <g transform="translate(170 300)" className="cb-ghost">
        <path d="M-64 -100 V14 A64 24 0 0 0 64 14 V-100" fill="none" />
        <ellipse cy="-100" rx="64" ry="24" fill="none" />
      </g>
      {/* lower half: lost to the house */}
      <g transform="translate(170 300)">
        <g className="cb-lost">
          {[0, 1, 2].map(chip)}
        </g>
      </g>
      {/* return path */}
      <path className="cb-path" d="M190 160 C 230 40, 420 40, 470 196" />
      {[0, 1, 2, 3, 4, 5, 6].map((i) => {
        const t = (i + 1) / 8;
        const u = 1 - t;
        const x = u ** 3 * 190 + 3 * u * u * t * 230 + 3 * u * t * t * 420 + t ** 3 * 470;
        const y = u ** 3 * 160 + 3 * u * u * t * 40 + 3 * u * t * t * 40 + t ** 3 * 196;
        return <circle key={i} cx={x} cy={y} r="6" className="cb-dot" style={{ "--i": i }} />;
      })}
      <path d="M452 186 L470 214 L488 184 Z" className="cb-head" />
      {/* the returned half travels the arc */}
      <g transform="translate(470 300)">
        <g className="cb-back">
          {[0, 1, 2].map(chip)}
        </g>
      </g>
      <g transform="translate(470 300)" className="cb-badge hr-c">
        <g transform="translate(82 -60)">
          <circle r="40" fill="url(#hr-gold)" stroke="#fff1b8" strokeWidth="3" />
          <text y="14" textAnchor="middle" className="hr-num" fontSize="40" fill="#3a2506">
            ½
          </text>
        </g>
      </g>
      <g transform="translate(170 352)" className="cb-tag">
        <text textAnchor="middle" className="hr-label" fontSize="18" fill="#9fb8a9">
          STAKE
        </text>
      </g>
      <g transform="translate(470 352)" className="cb-tag cb-tag-back">
        <text textAnchor="middle" className="hr-label" fontSize="18">
          BACK TO YOU
        </text>
      </g>
      <g transform="translate(170 110)" className="cb-craps hr-c">
        <rect x="-66" y="-22" width="132" height="44" rx="10" fill="#c8323a" />
        <text y="10" textAnchor="middle" className="hr-label" fontSize="26" fill="#fff2d0">
          CRAPS
        </text>
      </g>
    </>
  );
}

/* ---------------- Lucky Seven ---------------- */
const SEVEN = "M-92 -128 H96 V-86 L6 132 H-58 L28 -78 H-48 V-54 H-92 Z";

function LuckySeven() {
  return (
    <>
      <clipPath id="ls-clip">
        <path d={SEVEN} transform="translate(320 200)" />
      </clipPath>
      <circle cx="320" cy="200" r="210" fill="url(#hr-gold-glow)" className="ls-glow" />
      <g transform="translate(320 200)">
        <g className="ls-rays hr-c">
          <Rays count={20} inner={60} outer={260} />
        </g>
        <g className="ls-rays-2 hr-c">
          <Rays count={10} inner={120} outer={210} />
        </g>
      </g>
      <g className="ls-seven-wrap">
        <g transform="translate(320 200)">
          <g className="ls-seven hr-c">
            <path d={SEVEN} transform="translate(10 12)" fill="url(#hr-gold-edge)" />
            <path d={SEVEN} transform="translate(5 6)" fill="#7a4d0f" />
            <path d={SEVEN} fill="url(#hr-gold)" stroke="#fff1b8" strokeWidth="4" strokeLinejoin="round" />
            <path d={SEVEN} fill="none" stroke="#8a5a12" strokeWidth="2" transform="scale(0.88) translate(2 4)" opacity="0.6" />
          </g>
        </g>
        <g clipPath="url(#ls-clip)">
          <rect x="120" y="40" width="90" height="340" fill="url(#hr-shine)" className="ls-shine" transform="skewX(-18)" />
        </g>
      </g>
      <g className="ls-stars" fill="#fff4c6">
        {[
          [150, 110, 20],
          [490, 92, 26],
          [520, 290, 16],
          [128, 300, 14],
          [440, 352, 12],
          [214, 48, 12],
        ].map(([x, y, r], i) => (
          <g key={i} transform={`translate(${x} ${y})`}>
            <g className="ls-star hr-c" style={{ "--i": i }}>
              <Star r={r} />
            </g>
          </g>
        ))}
      </g>
      <g className="ls-tag hr-c" transform="translate(320 368)">
        <rect x="-70" y="-22" width="140" height="44" rx="22" className="hr-pill" />
        <text y="9" textAnchor="middle" className="hr-label" fontSize="24">
          2 : 1
        </text>
      </g>
    </>
  );
}

/* ---------------- Pass the Dice ---------------- */
function Seat({ label }) {
  return (
    <g>
      <circle r="66" className="pd-seat-base" />
      <circle cy="-16" r="22" className="pd-seat-figure" />
      <path d="M-38 34 C -34 6, 34 6, 38 34 Z" className="pd-seat-figure" />
      <g transform="translate(0 96)">
        <rect x="-74" y="-18" width="148" height="36" rx="18" className="pd-plate" />
        <text y="7" textAnchor="middle" className="hr-label" fontSize="17">
          {label}
        </text>
      </g>
    </g>
  );
}

function PassTheDice() {
  const arc = (t) => {
    const x = 120 + (520 - 120) * t;
    const y = 150 - 4 * 120 * t * (1 - t);
    return [x, y];
  };
  return (
    <>
      <ellipse cx="320" cy="230" rx="300" ry="160" fill="url(#hr-glow)" className="hr-fade" />
      <g transform="translate(110 220)">
        <g className="pd-from">
          <Seat label="SHOOTER" />
        </g>
      </g>
      <g transform="translate(530 220)">
        <circle r="84" className="pd-halo hr-c" />
        <g className="pd-to">
          <Seat label="NEXT UP" />
        </g>
      </g>
      {Array.from({ length: 9 }, (_, i) => {
        const [x, y] = arc((i + 1) / 10);
        return <circle key={i} cx={x} cy={y} r={4 + i * 0.6} className="pd-trail" style={{ "--i": i }} />;
      })}
      <g className="pd-toss">
        <g className="pd-spin hr-c">
          <Die value={5} size={84} />
        </g>
      </g>
      <g transform="translate(320 330)" className="pd-arrow">
        <path d="M-70 0 H54 M40 -14 L60 0 L40 14" />
      </g>
    </>
  );
}

/* ---------------- Table Jackpot ---------------- */
function TableJackpot() {
  const pucks = [
    [110, 290, 4],
    [320, 340, 6],
    [530, 290, 9],
  ];
  const coins = [
    [-150, -40, 0],
    [-110, -120, 1],
    [-60, -150, 2],
    [-20, -100, 3],
    [40, -160, 4],
    [90, -110, 5],
    [140, -60, 6],
    [170, -130, 7],
    [-180, -110, 8],
    [10, -180, 9],
    [-80, -70, 10],
    [120, -170, 11],
  ];
  return (
    <>
      <circle cx="320" cy="165" r="220" fill="url(#hr-gold-glow)" className="tj-glow" />
      <g transform="translate(320 165)">
        <g className="tj-rays hr-c">
          <Rays count={16} inner={90} outer={300} />
        </g>
      </g>
      {pucks.map(([x, y], i) => (
        <line key={i} x1={x} y1={y} x2="320" y2="165" className={`tj-beam tj-beam-${i}`} />
      ))}
      <g transform="translate(320 165)">
        {/* locked vault disc */}
        <g className="tj-lock hr-c">
          <circle r="104" fill="#173c2e" stroke="#5f7d6b" strokeWidth="6" />
          <circle r="80" fill="none" stroke="#3e5c4b" strokeWidth="3" strokeDasharray="6 8" />
          <path d="M-20 -10 V-30 A20 20 0 0 1 20 -30 V-10" fill="none" stroke="#88a593" strokeWidth="9" />
          <rect x="-32" y="-12" width="64" height="48" rx="8" fill="#88a593" />
          {[-120, 0, 120].map((a, i) => (
            <circle key={a} r="10" cy="-92" transform={`rotate(${a + 180})`} className={`tj-notch tj-notch-${i}`} />
          ))}
        </g>
        {/* the oversized jackpot chip */}
        <g className="tj-chip hr-c">
          <circle r="118" fill="url(#hr-gold)" stroke="#fff1b8" strokeWidth="4" />
          {Array.from({ length: 8 }, (_, i) => (
            <rect key={i} x="-13" y="-118" width="26" height="30" fill="#12382a" transform={`rotate(${i * 45})`} />
          ))}
          <circle r="86" fill="#12382a" stroke="#f5c757" strokeWidth="4" />
          <circle r="74" fill="none" stroke="#f5c757" strokeWidth="2" strokeDasharray="4 7" />
          <g transform="translate(0 -26)" fill="#ffd970">
            <path d="M-26 -18 H26 V0 C26 18, 14 30, 0 30 C -14 30, -26 18, -26 0 Z" />
            <path d="M-26 -10 C-46 -10, -46 14, -20 16 M26 -10 C46 -10, 46 14, 20 16" fill="none" stroke="#ffd970" strokeWidth="6" />
            <rect x="-6" y="28" width="12" height="12" />
            <rect x="-20" y="38" width="40" height="8" rx="2" />
          </g>
          <text y="48" textAnchor="middle" className="hr-label" fontSize="22" fill="#ffe7a1">
            JACKPOT
          </text>
        </g>
        <g className="tj-coins">
          {coins.map(([x, y, i]) => (
            <g key={i} className="tj-coin" style={{ "--x": `${x}px`, "--y": `${y}px`, "--i": i }}>
              <ellipse rx="15" ry="15" fill="url(#hr-gold)" stroke="#fff1b8" strokeWidth="2" />
              <ellipse rx="8" ry="8" fill="none" stroke="#8a5a12" strokeWidth="2" />
            </g>
          ))}
        </g>
      </g>
      {pucks.map(([x, y, n], i) => (
        <g key={n} transform={`translate(${x} ${y}) scale(0.78)`}>
          <g className={`tj-puck tj-puck-${i} hr-c`}>
            <Puck label={n} sub="POINT" lit />
          </g>
        </g>
      ))}
    </>
  );
}

const SCENES = {
  secondWind: SecondWind,
  hardPoint: HardPoint,
  hotHand: HotHand,
  crapsCashback: CrapsCashback,
  luckySeven: LuckySeven,
  passTheDice: PassTheDice,
  tableJackpot: TableJackpot,
};

export default function HouseRuleArt({ rule }) {
  const Scene = SCENES[rule];
  return (
    <div className={`house-rule-art is-${rule}`} aria-hidden="true">
      <svg viewBox="0 0 640 400" focusable="false">
        <Defs />
        {Scene && <Scene />}
      </svg>
    </div>
  );
}
