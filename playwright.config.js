import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/e2e",
  // CI renders the real 3D scene with software WebGL. Allow for shared-runner latency.
  timeout: 180000,
  expect: { timeout: process.env.CI ? 20000 : 5000 },
  fullyParallel: false,
  // A retry would inherit this session's in-memory table; fail the original case instead.
  retries: 0,
  use: {
    baseURL: "http://127.0.0.1:4321",
    headless: true,
    trace: {
      mode: "retain-on-failure",
      screenshots: false,
      snapshots: true,
      sources: true,
    },
    launchOptions: {
      args: [
        process.platform === "darwin" && !process.env.CI
          ? "--use-angle=metal"
          : "--use-angle=swiftshader",
        "--enable-webgl",
        "--ignore-gpu-blocklist",
      ],
    },
  },
  webServer: {
    command: "node server/index.js",
    url: "http://127.0.0.1:4321/api/config",
    env: { PORT: "4321", CRAPSTV_MDNS: "0", CRAPSTV_JOIN_MODE: "ip" },
    reuseExistingServer: false,
    timeout: 20000,
  },
  reporter: process.env.CI ? "github" : "list",
});
