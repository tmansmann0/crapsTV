import { createServer } from "vite";
import { chromium } from "@playwright/test";
import { writeFile } from "node:fs/promises";
const phase = process.argv[2] || "before";
const server = await createServer({
  configFile: false,
  appType: "custom",
  server: { host: "127.0.0.1", port: 0, hmr: false },
  optimizeDeps: {
    include: [
      "three",
      "three/addons/loaders/GLTFLoader.js",
      "three/addons/loaders/EXRLoader.js",
    ],
  },
});
server.middlewares.use((req, res, next) => {
  if (req.url === "/__cups") {
    res.setHeader("content-type", "text/html");
    res.end(
      '<script type="module" src="/scripts/qa/cupholders-view.js"></script>',
    );
  } else next();
});
let browser;
const errors = [];
try {
  await server.listen();
  browser = await chromium.launch({
    headless: true,
    args: ["--use-angle=metal", "--enable-webgl", "--ignore-gpu-blocklist"],
  });
  const page = await browser.newPage({
    viewport: { width: 1600, height: 1000 },
  });
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await page.goto(
    `http://127.0.0.1:${server.httpServer.address().port}/__cups`,
  );
  await page.waitForFunction(() => window.ready, {}, { timeout: 60000 });
  const report = { errors, views: {}, rays:await page.evaluate(()=>window.cupRayProof()) };
  for (let index=0;index<4;index++) for (const view of ["high","low"]) {
    const key=`${index}-${view}`;
    report.views[key]=await page.evaluate(({index,view})=>window.captureCup(index,view),{index,view});
    await page.screenshot({path:`artifacts/cupholders-${phase}-${key}.png`});
  }
  for(let index=0;index<4;index++) for(let n=0;n<8;n++) {
    const angle=n/8*Math.PI*2;
    report.views[`orbit-${index}-${n}`]=await page.evaluate(({index,angle})=>window.captureCup(index,"orbit",angle),{index,angle});
    if(index===3) await page.screenshot({path:`artifacts/cupholders-${phase}-orbit-${n}.png`});
  }
  await writeFile(`artifacts/cupholders-${phase}-qa.json`,JSON.stringify(report,null,2));
  console.log(JSON.stringify({errors,views:Object.keys(report.views).length,rays:report.rays.map(c=>({index:c.index,rimMaterials:[...new Set(c.rim)],insideMaterials:[...new Set(c.inside)]}))}));
  if (errors.length) process.exitCode = 1;
} finally {
  await browser?.close();
  await server.close();
}
