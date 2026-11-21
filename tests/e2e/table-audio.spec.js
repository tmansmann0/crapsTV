import { expect, test } from "@playwright/test";
import { RoomHub } from "../../src/hub.js";
import { clickTV } from "../helpers/tv-actions.mjs";

test("the TV plays chip landings and dice contacts and saves its mix", async ({
  page,
}) => {
  const code = "AUDIOT";
  const hub = new RoomHub(code);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    await page.addInitScript(() => {
      window.playedEffects = [];
      window.audioLayers = new Map();
      const start = AudioBufferSourceNode.prototype.start;
      AudioBufferSourceNode.prototype.start = function (...args) {
        start.apply(this, args);
        if (this.buffer) window.playedEffects.push(this.buffer.duration);
      };
      const play = HTMLMediaElement.prototype.play;
      HTMLMediaElement.prototype.play = function () {
        window.audioLayers.set(new URL(this.src).pathname, this);
        return play.call(this);
      };
    });
    await page.route("**/api/config", (route) =>
      route.fulfill({ json: { local: true, code } }),
    );
    await page.routeWebSocket("**/socket", (socket) => {
      hub.connect("tv", (message) => socket.send(JSON.stringify(message)));
      socket.onMessage((message) => hub.receive("tv", JSON.parse(message)));
      socket.onClose(() => hub.disconnect("tv"));
    });
    await page.goto("/");
    const canvas = page.locator(".table-canvas");
    await expect(canvas).toHaveAttribute("data-scene-ready", "true", {
      timeout: 60000,
    });
    await clickTV(page, "settings");
    await clickTV(page, "audio");
    const dialog = page.getByRole("dialog", { name: "Table audio" });
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByRole("slider", { name: "Dice and chips" }),
    ).toHaveValue("75");
    const music = dialog.getByRole("combobox", { name: "Music", exact: true });
    await expect(music).toHaveValue("off");
    await dialog.getByRole("button", { name: "Test effects" }).click();
    await expect
      .poll(() => page.evaluate(() => window.playedEffects.length), {
        timeout: 10000,
      })
      .toBeGreaterThanOrEqual(7);

    await dialog.getByRole("slider", { name: "Room ambience" }).press("End");
    await music.selectOption("moil");
    await expect
      .poll(() =>
        page.evaluate(() =>
          ["/audio/table/room.mp3", "/audio/table/moil.mp3"].every(
            (path) => window.audioLayers.get(path)?.currentTime > 0,
          ),
        ),
      )
      .toBe(true);
    await music.selectOption("off");
    await expect
      .poll(() =>
        page.evaluate(
          () => window.audioLayers.get("/audio/table/moil.mp3")?.paused,
        ),
      )
      .toBe(true);
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            JSON.parse(localStorage.getItem("crapstv.table-audio")).ambience,
        ),
      )
      .toBe(1);
    await dialog.getByRole("button", { name: "Close table audio" }).click();
    await expect(dialog).toBeHidden();

    hub.connect("host", () => {});
    hub.receive("host", { type: "join", code, name: "Alice" });
    hub.receive("host", { type: "start", config: { rollCooldownSeconds: 0 } });
    await expect(canvas).toHaveAttribute("data-banks", /^[1-9]/);
    await page.evaluate(() => (window.playedEffects.length = 0));
    hub.receive("host", { type: "bet", betId: "pass", amount: 1500 });
    await expect
      .poll(
        () =>
          page.evaluate(() =>
            window.playedEffects.some((duration) => duration > 0.15),
          ),
        { timeout: 10000 },
      )
      .toBe(true);
    await page.evaluate(() => (window.playedEffects.length = 0));
    hub.receive("host", { type: "roll", gesture: { x: 0.3, power: 0.7 } });
    expect(hub.state.throw.audioContacts.length).toBeGreaterThan(0);
    await expect
      .poll(
        () =>
          page.evaluate(() =>
            window.playedEffects.some((duration) => duration < 0.15),
          ),
        { timeout: 10000 },
      )
      .toBe(true);
    expect(errors).toEqual([]);
  } finally {
    hub.close();
  }
});
