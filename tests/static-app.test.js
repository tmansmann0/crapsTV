import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { serveBuiltApp } from "../server/static-app.js";

test("phone join routes work when the built app lives under a hidden user directory", async (t) => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "crapstv-static-"));
  const root = path.join(temporary, ".local", "crapstv");
  await mkdir(path.join(root, "dist/assets"), { recursive: true });
  await writeFile(path.join(root, "dist/index.html"), "<title>crapsTV</title>");
  await writeFile(
    path.join(root, "dist/assets/app.js"),
    "export const ready=true;",
  );
  const app = express();
  serveBuiltApp(app, root);
  const server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await rm(temporary, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  for (const route of ["/", "/join?code=ABCDEF", "/join/"]) {
    const response = await fetch(base + route);
    assert.equal(response.status, 200);
    assert.match(await response.text(), /<title>crapsTV<\/title>/);
  }
  const asset = await fetch(base + "/assets/app.js");
  assert.equal(asset.status, 200);
  assert.match(await asset.text(), /ready=true/);
});
