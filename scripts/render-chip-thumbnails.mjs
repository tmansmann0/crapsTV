import { createServer } from "vite";
import { chromium } from "@playwright/test";
import { writeFile } from "node:fs/promises";
const server = await createServer({ appType: "custom", server: { port: 0 } });
server.middlewares.use((req, res, next) => {
  if (req.url === "/__thumbs.html") {
    res.setHeader("content-type", "text/html");
    res.end('<!doctype html><base href="/">');
  } else next();
});
let browser;
try {
  await server.listen();
  const port = server.httpServer.address().port;
  browser = await chromium.launch({
    headless: true,
    args: [
      process.platform === "darwin"
        ? "--use-angle=metal"
        : "--use-angle=swiftshader",
      "--enable-webgl",
    ],
  });
  const page = await browser.newPage();
  await page.goto(`http://localhost:${port}/__thumbs.html`);
  const images = await page.evaluate(async () => {
    const { renderChipThumbnails } = await import("/src/chip-rendering.js");
    return renderChipThumbnails([100, 500, 2500, 10000, 50000], { size: 192 });
  });
  for (const [value, data] of Object.entries(images))
    await writeFile(
      `public/assets/chip-${value}.png`,
      Buffer.from(data.split(",")[1], "base64"),
    );
  console.log("Rendered five chip thumbnails from chip.glb.");
} finally {
  await browser?.close();
  await server.close();
}
