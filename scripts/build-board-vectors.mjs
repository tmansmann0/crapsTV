// Original vector art developed with Claude Desktop, selected/refined by Codex.
// Text masters retain editable lettering. Production SVGs contain glyph paths.
import { chromium } from "@playwright/test";
import {
  readFile,
  writeFile,
  mkdir,
  copyFile,
  mkdtemp,
  rm,
} from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  build,
  buildCrapless,
} from "../assets/source/board-design/heritage.mjs";
const run = promisify(execFile),
  root = fileURLToPath(new URL("../", import.meta.url));
const masterDir = join(root, "assets/source/board-design/text");
await mkdir(masterDir, { recursive: true });
for (const [mode, make] of [
  ["classic", build],
  ["crapless", buildCrapless],
])
  await writeFile(join(root, `public/assets/board-${mode}.svg`), make());
await run(
  process.execPath,
  ["scripts/board-layout-manifest.mjs", "--annotate"],
  { cwd: root },
);
for (const mode of ["classic", "crapless"])
  await copyFile(
    join(root, `public/assets/board-${mode}.svg`),
    join(masterDir, `board-${mode}.svg`),
  );
if (!process.argv.includes("--text-only")) {
  const temporary = await mkdtemp(join(tmpdir(), "crapstv-board-"));
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({
      viewport: { width: 2048, height: 1024 },
    });
    for (const mode of ["classic", "crapless"]) {
      const master = await readFile(
        join(masterDir, `board-${mode}.svg`),
        "utf8",
      );
      await page.setContent(
        `<html><head><style>@page{size:2048px 1024px;margin:0}html,body{margin:0;width:2048px;height:1024px;overflow:hidden;background:transparent}svg{display:block}</style></head><body>${master.replace(/<\?xml[^>]+>/, "")}</body></html>`,
      );
      await page.evaluate(() => document.fonts.ready);
      const pdf = join(temporary, `${mode}.pdf`),
        outlined = join(temporary, `${mode}.svg`);
      await page.pdf({
        path: pdf,
        width: "2048px",
        height: "1024px",
        margin: { top: 0, right: 0, bottom: 0, left: 0 },
        printBackground: true,
      });
      await run("pdftocairo", ["-svg", pdf, outlined]);
      let artwork = (await readFile(outlined, "utf8")).replace(
        /<\?xml[^>]+>/,
        "",
      );
      artwork = artwork.replace(
        /<svg\b([^>]*)>/,
        (tag, attributes) =>
          `<svg${attributes.replace(/\swidth="[^"]*"/, ' width="2048"').replace(/\sheight="[^"]*"/, ' height="1024"')}>`,
      );
      if (/<text\b|<font\b/.test(artwork))
        throw new Error("Outline export retained external font dependency.");
      await writeFile(
        join(root, `public/assets/board-${mode}.svg`),
        `<?xml version="1.0" encoding="utf-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="2048" height="1024" viewBox="0 0 2048 1024"><title>crapsTV Heritage Emerald — ${mode}</title><desc>Original editable vector print. Production lettering is outlined; text master and named bet groups are in assets/source/board-design/text. Only the original brand logo is raster.</desc><defs><clipPath id="felt-outline"><rect width="2048" height="1024" rx="160"/></clipPath></defs><g id="print-artwork" clip-path="url(#felt-outline)">${artwork}</g></svg>\n`,
      );
    }
  } finally {
    await browser?.close();
    await rm(temporary, { recursive: true, force: true });
  }
  await run(
    process.execPath,
    ["scripts/board-layout-manifest.mjs", "--annotate", "--master"],
    { cwd: root },
  );
}
await run(process.execPath, ["scripts/render-board-textures.mjs"], {
  cwd: root,
});
console.log(
  "Rebuilt classic/crapless text masters, outlined SVGs, semantic manifest and 2K/4K PNGs.",
);
