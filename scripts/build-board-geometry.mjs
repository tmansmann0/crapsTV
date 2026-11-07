import { createServer } from "vite";
import { chromium } from "@playwright/test";
import { writeFile, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
const server = await createServer({
  configFile: false,
  appType: "custom",
  server: { host: "127.0.0.1", port: 0, hmr: false },
  optimizeDeps: { include: ["three", "three/addons/loaders/SVGLoader.js"] },
});
server.middlewares.use((req, res, next) => {
  if (req.url === "/board-bake") {
    res.setHeader("content-type", "text/html");
    res.end("<body></body>");
  } else next();
});
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true, args: ["--disable-gpu"] });
  const page = await browser.newPage();
  await page.goto(
    `http://127.0.0.1:${server.httpServer.address().port}/board-bake`,
  );
  for (const mode of ["classic", "crapless"]) {
    const result = await page.evaluate(async (mode) => {
      const { bakeBoardVectors } = await import("/src/board-vector-bake.js");
      const source = await (await fetch(`/assets/board-${mode}.svg`)).text();
      const bake = bakeBoardVectors(source);
      const { stripBoardHatch } = await import("/src/board-hatch.js");
      const image = new Image(),
        url = URL.createObjectURL(
          new Blob([stripBoardHatch(source).svg], { type: "image/svg+xml" }),
        );
      image.src = url;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = 2048;
      canvas.height = 1024;
      canvas.getContext("2d").drawImage(image, 0, 0, 2048, 1024);
      URL.revokeObjectURL(url);
      const minified = canvas.toDataURL("image/png").split(",")[1];
      const encode = (array) => {
        const bytes = new Uint8Array(array.buffer);
        let s = "";
        for (let i = 0; i < bytes.length; i += 8192)
          s += String.fromCharCode(...bytes.subarray(i, i + 8192));
        return btoa(s);
      };
      return {
        positions: encode(bake.positions),
        colors: encode(bake.colors),
        paints: encode(bake.paints),
        indices: encode(bake.indices),
        metadata: bake.metadata,
        minified,
      };
    }, mode);
    const parts = ["positions", "colors", "paints", "indices"].map((k) =>
      Buffer.from(result[k], "base64"),
    );
    const header = Buffer.alloc(32);
    header.write("CVB2");
    header.writeUInt32LE(result.metadata.vertices, 4);
    header.writeUInt32LE(result.metadata.triangles * 3, 8);
    header.writeUInt32LE(2048, 12);
    header.writeUInt32LE(1024, 16);
    header.writeUInt32LE(result.metadata.paintCount, 20);
    header.writeUInt32LE(result.metadata.logoPaint, 24);
    const binary = Buffer.concat([header, ...parts]);
    await writeFile(`public/assets/board-${mode}-vector.bin`, binary);
    const source = await readFile(`public/assets/board-${mode}.svg`);
    const minified = Buffer.from(result.minified, "base64");
    await writeFile(`public/assets/board-${mode}-minified.png`, minified);
    const metadata = {
      ...result.metadata,
      sourceSHA256: createHash("sha256").update(source).digest("hex"),
      binarySHA256: createHash("sha256").update(binary).digest("hex"),
      bytes: binary.length,
      minificationFallback: {
        width: 2048,
        height: 1024,
        file: `board-${mode}-minified.png`,
        sha256: createHash("sha256").update(minified).digest("hex"),
      },
    };
    await writeFile(
      `public/assets/board-${mode}-vector.json`,
      JSON.stringify(metadata, null, 2) + "\n",
    );
    console.log(mode, metadata);
  }
} finally {
  await browser?.close();
  await server.close();
}
