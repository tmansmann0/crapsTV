import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileRoomSave } from "../server/room-save-file.js";
import * as game from "../src/game.js";
import { RoomHub } from "../src/hub.js";

test("a restarted table keeps host chip adjustments and settles the saved Field wager at 2:1", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "crapstv-session-upgrade-"));
  const store = fileRoomSave(join(directory, "room.json"));
  const code = "UPGRAD";
  const errors = [];
  let hub = new RoomHub(code, { saveStore: store });
  t.after(() => {
    hub.close();
    rmSync(directory, { recursive: true, force: true });
  });

  function seat(client, name, token) {
    let welcome;
    hub.connect(client, (message) => {
      if (message.type === "error") errors.push(message.message);
      if (message.type === "welcome") welcome = message;
    });
    hub.receive(client, { type: "join", code, name, token });
    assert(welcome);
    return welcome;
  }

  const host = seat("host", "Host");
  const guest = seat("guest", "Guest");
  hub.receive("host", { type: "start", config: { rollCooldownSeconds: 0 } });
  hub.receive("host", {
    type: "adjust-bankroll",
    playerId: guest.playerId,
    amount: 2500,
  });
  hub.receive("guest", { type: "bet", betId: "field", amount: 500 });
  hub.receive("host", { type: "save-session" });
  assert(hub.state.pausedAt);
  hub.close();

  const restored = store.load();
  hub = new RoomHub(code, { saveStore: store, restored });
  assert.equal(seat("new-host", "Host", host.token).playerId, host.playerId);
  assert.equal(
    seat("new-guest", "Guest", guest.token).playerId,
    guest.playerId,
  );
  hub.receive("new-host", { type: "resume-session" });
  const player = hub.state.players.find(({ id }) => id === guest.playerId);
  assert.deepEqual(player.bankrollAdjustments, { added: 2500, removed: 0 });
  assert.equal(player.bank, 102000);
  assert.equal(player.bets.length, 1);
  assert.equal(game.net(player), 0);

  game.beginRoll(hub.state, host.playerId);
  game.finishRoll(hub.state, [6, 6]);
  assert.equal(player.bank, 103500);
  assert.equal(game.net(player), 1000);
  assert.equal(player.bets.length, 0);
  assert.deepEqual(errors, []);
});
