import { cpSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const require = createRequire(import.meta.url);

export default defineConfig(() => {
  // The MediaPipe loader requires the original filenames in the same directory.
  const vision = dirname(require.resolve("@mediapipe/tasks-vision"));
  cpSync(
    join(vision, "wasm"),
    fileURLToPath(new URL("./public/pocketface/wasm/", import.meta.url)),
    { recursive: true },
  );
  return {
    plugins: [react()],
    base: "./",
    build: { chunkSizeWarningLimit: 1100 },
  };
});
