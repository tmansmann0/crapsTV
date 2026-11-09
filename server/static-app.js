import express from "express";
import path from "node:path";

export function serveBuiltApp(app, root) {
  const directory = path.join(root, "dist");
  app.use(express.static(directory));
  // User-owned TV installs often live under ~/.local. Only the requested file,
  // rather than any absolute parent directory, participates in dotfile checks.
  app.use((_req, res) => res.sendFile("index.html", { root: directory }));
}
