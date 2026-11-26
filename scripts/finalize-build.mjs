import { copyFile, writeFile } from "node:fs/promises";
// GitHub Pages serves this entry for /join while preserving the controller URL.
await copyFile(
  new URL("../dist/index.html", import.meta.url),
  new URL("../dist/404.html", import.meta.url),
);
if (process.argv.includes("--desktop"))
  await writeFile(new URL("../dist/.crapstv-desktop", import.meta.url), "");
