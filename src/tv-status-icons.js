const brass = "#d6bb7d";
const ivory = "#f0e5cd";

// All marks share a 32-unit grid and two ink colors so they read at handheld size.
const diceOutline =
  "M9 11V8a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3v11a3 3 0 0 1-3 3h-4 M5 11h12a3 3 0 0 1 3 3v11a3 3 0 0 1-3 3H5a3 3 0 0 1-3-3V14a3 3 0 0 1 3-3Z";
const outlines = {
  "come-out": diceOutline,
  point:
    "M16 4a12 12 0 1 0 0 24 12 12 0 1 0 0-24Z M16 7v3m0 12v3M7 16h3m12 0h3",
  rolling:
    "m15 5 11 4a3 3 0 0 1 2 4l-4 11a3 3 0 0 1-4 2L9 22a3 3 0 0 1-2-4l4-11a3 3 0 0 1 4-2Z M3 8h4M2 12h3m21 15h3",
  win: "m16 3 13 13-13 13L3 16Z",
  loss: "m16 3 13 13-13 13L3 16Z",
  player: "M16 5a5 5 0 1 0 0 10 5 5 0 1 0 0-10Z M6 26v-2a10 8 0 0 1 20 0v2",
  notice: "M14 6a2.3 2.3 0 0 1 4 0l11 18a2 2 0 0 1-2 3H5a2 2 0 0 1-2-3Z",
  connection:
    "M3 11a20 20 0 0 1 26 0M8 16a12 12 0 0 1 16 0m-12 5a6 6 0 0 1 8 0",
  closed: "M4 13h24v14H4Z M8 13V9a8 8 0 0 1 16 0v4",
};
const details = {
  win: "m10 16 4 4 8-9",
  loss: "m12 12 8 8m0-8-8 8",
  notice: "M16 12v6",
  closed: "M16 19v3",
};
const dots = {
  "come-out": [
    [7, 16],
    [11, 20],
    [15, 24],
    [22, 10],
    [24, 15],
  ],
  point: [[16, 16, 2.6]],
  rolling: [
    [14, 11],
    [18, 15.5],
    [21.5, 20],
  ],
  notice: [[16, 22]],
  connection: [[16, 25, 1.8]],
};
const outlinePaths = new Map();
const detailPaths = new Map();

export function drawStatusIcon(ctx, icon, x, y, size) {
  ctx.save();
  ctx.translate(x - size / 2, y - size / 2);
  ctx.scale(size / 32, size / 32);
  ctx.lineWidth = 1.65;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = brass;
  if (!outlinePaths.has(icon))
    outlinePaths.set(icon, new Path2D(outlines[icon] || outlines["come-out"]));
  ctx.stroke(outlinePaths.get(icon));
  ctx.fillStyle = ctx.strokeStyle = ivory;
  ctx.lineWidth = 2.15;
  if (details[icon]) {
    if (!detailPaths.has(icon))
      detailPaths.set(icon, new Path2D(details[icon]));
    ctx.stroke(detailPaths.get(icon));
  }
  for (const [dotX, dotY, radius = 1.2] of dots[icon] || []) {
    ctx.beginPath();
    ctx.arc(dotX, dotY, radius, 0, 2 * Math.PI);
    ctx.fill();
  }
  ctx.restore();
}
