// Lossless web delivery of native GPU captures. Requires the cwebp authoring CLI.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  readFile,
  writeFile,
  mkdir,
  copyFile,
  unlink,
  access,
} from "node:fs/promises";
import assert from "node:assert/strict";
import { pngDifference } from "./png-difference.mjs";
const run = promisify(execFile);
const folder = "public/studies/effects";
await mkdir("artifacts/effects-study-native", { recursive: true });
for (const shot of ["macro", "lamp"]) {
  for (const mode of [
    "off",
    "on",
    "reflections",
    "shadows",
    "flares",
    "restored",
  ]) {
    const name = `${shot}-${mode}.png`,
      source = `${folder}/${name}`;
    await copyFile(source, `artifacts/effects-study-native/${name}`);
    if (mode !== "restored" && !(shot === "macro" && mode === "flares"))
      await run("cwebp", [
        "-quiet",
        "-lossless",
        "-z",
        "6",
        source,
        "-o",
        `${folder}/${shot}-${mode}.webp`,
      ]);
    await unlink(source);
  }
  // Retain the original optical treatment so the old, faint setting can be
  // inspected against the same Off capture without changing exposure.
  if (shot === "macro") continue;
  const original = `artifacts/effects-current/${shot}-flares.png`;
  const preserved = `${folder}/${shot}-flares-original.webp`;
  try {
    await access(original);
    assert.equal(
      pngDifference(
        await readFile(`artifacts/effects-current/${shot}-off.png`),
        await readFile(`artifacts/effects-study-native/${shot}-off.png`),
      ).changedPixels,
      0,
      "original flare comparison must have an identical Off render",
    );
    await run("cwebp", [
      "-quiet",
      "-lossless",
      "-z",
      "6",
      original,
      "-o",
      preserved,
    ]);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    // A fresh checkout already contains the preserved 0.14.0 reference capture.
    await access(preserved);
  }
}
const manifest = JSON.parse(await readFile(`${folder}/manifest.json`, "utf8"));
manifest.delivery =
  "Lossless WebP of native 3840×2160 GPU captures; unedited pixels";
manifest.originalFlareVersion = "0.14.0";
await writeFile(
  `${folder}/manifest.json`,
  JSON.stringify(manifest, null, 2) + "\n",
);
