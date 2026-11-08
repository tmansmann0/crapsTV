// Rasterize outlined vector artwork identically at 2K and 4K, on any platform.
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
    for (const width of [2048, 4096]) {
      const suffix = width === 4096 ? "-4k" : "";
      const destination = new URL(
        `../public/assets/board-${mode}${suffix}.png`,
        import.meta.url,
      );
      const temporary = new URL(
        `../public/assets/.board-${mode}${suffix}.tmp`,
        import.meta.url,
      );
      const svg = (await readFile(source)).toString("base64");
      const png = await page.evaluate(
        async ({ data, width }) => {
          const image = new Image();
          image.src = `data:image/svg+xml;base64,${data}`;
          await image.decode();
          const canvas = document.createElement("canvas");
          canvas.width = width;
          canvas.height = width / 2;
          canvas.getContext("2d").drawImage(image, 0, 0, width, width / 2);
          return canvas.toDataURL("image/png").split(",")[1];
        },
        { data: svg, width },
      );
      try {
        await writeFile(temporary, Buffer.from(png, "base64"));
        await rename(temporary, destination);
      } finally {
        await rm(temporary, { force: true });
      }
      console.log(`${mode}: ${width} × ${width / 2}`);
    }
  }
} finally {
  await browser.close();
}
