// CPU-only slanted-edge measurement of the retained actual 4K macro frames.
import { PNG } from "pngjs";
import { readFile, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
function measure(image) {
  const { width, height, data } = image;
  const luma = (x, y) => {
    const i = (y * width + x) * 4;
    return 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
  };
  const rows = [];
  for (let y = 800; y < 1200; y++) {
    const low = luma(1200, y),
      high = luma(2000, y);
    if (high - low < 100) continue;
    const middle = (high + low) / 2;
    for (let x = 1301; x < 2100; x++)
      if (luma(x, y) >= middle && luma(x - 1, y) < middle) {
        const a = luma(x - 1, y),
          b = luma(x, y);
        rows.push({ y, edge: x - 1 + (middle - a) / (b - a), low, high });
        break;
      }
  }
  assert(
    rows.length > 300,
    "the actual ivory numeral has a long straight diagonal",
  );
  const meanY = rows.reduce((s, r) => s + r.y, 0) / rows.length,
    meanX = rows.reduce((s, r) => s + r.edge, 0) / rows.length;
  const slope =
      rows.reduce((s, r) => s + (r.y - meanY) * (r.edge - meanX), 0) /
      rows.reduce((s, r) => s + (r.y - meanY) ** 2, 0),
    intercept = meanX - slope * meanY;
  const residual = Math.sqrt(
    rows.reduce((s, r) => s + (r.edge - slope * r.y - intercept) ** 2, 0) /
      rows.length,
  );
  const bins = new Map();
  for (const row of rows) {
    const edge = slope * row.y + intercept;
    for (let x = Math.floor(edge) - 5; x <= Math.ceil(edge) + 5; x++) {
      const distance = (x - edge) / Math.sqrt(1 + slope * slope),
        bin = Math.round(distance * 32);
      const b = bins.get(bin) || { sum: 0, count: 0 };
      b.sum += (luma(x, row.y) - row.low) / (row.high - row.low);
      b.count++;
      bins.set(bin, b);
    }
  }
  const samples = [...bins]
    .map(([bin, b]) => ({
      distance: bin / 32,
      value: b.sum / b.count,
      count: b.count,
    }))
    .sort((a, b) => a.distance - b.distance);
  const crossing = (value) => {
    for (let i = 1; i < samples.length; i++) {
      const a = samples[i - 1],
        b = samples[i];
      if (a.value <= value && b.value >= value && b.value !== a.value)
        return (
          a.distance +
          ((b.distance - a.distance) * (value - a.value)) / (b.value - a.value)
        );
    }
    throw Error("edge crossing unavailable");
  };
  return {
    rows: rows.length,
    slope,
    fitResidualPixels: residual,
    edge10: crossing(0.1),
    edge90: crossing(0.9),
    width10to90: crossing(0.9) - crossing(0.1),
    bins: samples,
  };
}
const measurements = [];
for (const antialias of [1, 0]) {
  const path = `artifacts/board-classic-macro-aa${antialias}.png`;
  const result = measure(PNG.sync.read(await readFile(path)));
  assert(result.fitResidualPixels < 0.4);
  assert(
    result.width10to90 <= 1.5,
    "actual macro type resolves in at most 1.5 native pixels",
  );
  measurements.push({ antialias, path, ...result });
}
await writeFile(
  "docs/benchmarks/board-edge-sharpness.json",
  JSON.stringify(
    {
      method:
        "Native 4K final tone-mapped frame, 400-row slanted ivory numeral edge, 1/32px ESF bins; no image resampling",
      measurements,
    },
    null,
    2,
  ) + "\n",
);
console.log(
  measurements.map(({ antialias, width10to90, fitResidualPixels }) => ({
    antialias,
    width10to90,
    fitResidualPixels,
  })),
);
