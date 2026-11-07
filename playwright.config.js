import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 60000,
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: "http://127.0.0.1:4321",
    headless: true,
    trace: "retain-on-failure",
    launchOptions: {
      args: [
        "--use-angle=swiftshader",
        "--enable-webgl",
        "--ignore-gpu-blocklist",
      ],
    },
  },
  webServer: {
    command: "node server/index.js",
    url: "http://127.0.0.1:4321/api/config",
    env: { PORT: "4321" },
    reuseExistingServer: false,
    timeout: 20000,
  },
  reporter: process.env.CI ? "github" : "list",
});
