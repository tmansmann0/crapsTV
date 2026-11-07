// Rasterize the existing vector artwork at 4K. Original SVG and 2K PNGs stay intact.
import { chromium } from "@playwright/test";
import { readFile, writeFile, rename, rm } from "node:fs/promises";
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  for (const mode of ["classic", "crapless"]) {
    const source = new URL(
      `../public/assets/board-${mode}.svg`,
      import.meta.url,
    );
    const destination = new URL(
      `../public/assets/board-${mode}-4k.png`,
      import.meta.url,
    );
    const temporary = new URL(
      `../public/assets/.board-${mode}-4k.tmp`,
      import.meta.url,
    );
    const svg = (await readFile(source)).toString("base64");
    const png = await page.evaluate(async (data) => {
      const image = new Image();
      image.src = `data:image/svg+xml;base64,${data}`;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = 4096;
      canvas.height = 2048;
      canvas.getContext("2d").drawImage(image, 0, 0, 4096, 2048);
      return canvas.toDataURL("image/png").split(",")[1];
    }, svg);
    try {
      await writeFile(temporary, Buffer.from(png, "base64"));
      await rename(temporary, destination);
    } finally {
      await rm(temporary, { force: true });
    }
    console.log(`${mode}: 4096 × 2048`);
  }
} finally {
  await browser.close();
}
