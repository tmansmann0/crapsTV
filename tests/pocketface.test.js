import assert from "node:assert/strict";
import test from "node:test";
import * as game from "../src/game.js";
import { RoomHub } from "../src/hub.js";
import { captureRoomSave, readRoomSave } from "../src/room-save.js";

const style = { face: 1, hair: 3, shirt: "#284c41", hairColor: "#663b31" };

test("Pocketface setup is opt-in and bots need an individually selected avatar", () => {
  const state = game.createState("AVATAR");
  const host = game.join(state, "Host");
  const player = game.join(state, "Guest");
  assert.equal(state.config.avatarsEnabled, false);
  assert.throws(() => game.setAvatarsEnabled(state, player.id, true), /host/i);
  game.setAvatarsEnabled(state, host.id, true);
  assert.throws(() => game.addBot(state, host.id, { name: "Ruby" }), /avatar/);
  assert.equal(state.players.length, 2);
  game.configure(state, host.id, { minBet: 500 });
  assert.equal(state.config.avatarsEnabled, true);
  const ruby = game.addBot(state, host.id, { name: "Ruby", avatar: style });
  const lou = game.addBot(state, host.id, {
    name: "Lou",
    avatar: { ...style, face: 2 },
  });
  assert.notEqual(lou.avatarVersion, ruby.avatarVersion);
  assert.notDeepEqual(lou.pocketface, ruby.pocketface);
  assert.throws(
    () => game.setPocketface(state, host.id, player.id, style),
    /own avatar/,
  );
  game.setPocketface(state, player.id, undefined, style);
  assert.equal(game.setAvatarEmote(state, player.id, "Cheer"), true);
  assert.equal(game.setAvatarEmote(state, player.id, "Cheer"), false);
  game.setPocketface(state, host.id, ruby.id, { ...style, hair: 4 });
  assert.equal(ruby.pocketface.hair, 4);
  const restored = readRoomSave(
    JSON.stringify(
      captureRoomSave(state, new Map([["host-token", host.id]]), []),
    ),
  );
  assert.deepEqual(restored.state.players[1].pocketface, style);
  assert.equal(restored.state.players[1].avatarEmote, undefined);
  assert.equal(restored.state.config.avatarsEnabled, true);
});

test("room snapshots carry avatar versions and serve each portrait separately", async (t) => {
  const hub = new RoomHub("AVATAR");
  t.after(() => hub.close());
  const playerPackets = [],
    tvPackets = [];
  hub.connect("host", (message) => playerPackets.push(message));
  hub.connect("tv", (message) => tvPackets.push(message));
  hub.receive("host", { type: "join", code: "AVATAR", name: "Host" });
  hub.receive("host", { type: "avatars-enabled", enabled: true });
  hub.receive("host", { type: "pocketface", avatar: style });
  const seat = playerPackets.findLast((packet) => packet.type === "state").state
    .players[0];
  assert(seat.avatarVersion);
  assert.equal(seat.pocketface, undefined);
  hub.receive("tv", { type: "avatar-request", players: [seat.id] });
  assert.equal(
    tvPackets.some((packet) => packet.type === "avatar-data"),
    false,
  );
  hub.receive("tv", { type: "house-rule-display", visible: true });
  hub.receive("tv", { type: "avatar-request", players: [seat.id] });
  assert.deepEqual(tvPackets.at(-1), {
    type: "avatar-data",
    id: seat.id,
    version: seat.avatarVersion,
    profile: style,
  });
  hub.receive("host", { type: "avatars-enabled", enabled: false });
  const count = tvPackets.length;
  hub.receive("tv", { type: "avatar-request", players: [seat.id] });
  assert.equal(tvPackets.length, count);
});
