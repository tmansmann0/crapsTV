import { PNG } from "pngjs";

/** Compare decoded RGBA pixels, independent of PNG compression or metadata. */
export function pngDifference(first, second) {
  const a = PNG.sync.read(first),
    b = PNG.sync.read(second);
  if (a.width !== b.width || a.height !== b.height)
    throw new Error("PNG comparison dimensions differ");
  let sum = 0,
    max = 0,
    changedPixels = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    let changed = false;
    for (let channel = 0; channel < 4; channel++) {
      const difference = Math.abs(a.data[i + channel] - b.data[i + channel]);
      sum += difference;
      max = Math.max(max, difference);
      changed ||= difference !== 0;
    }
    if (changed) changedPixels++;
  }
  return {
    meanAbsoluteDifference: sum / a.data.length,
    maxChannelDifference: max,
    changedPixels,
  };
}
